import { Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EMPTY_PAYLOAD_SHA256, signRequest, toAmzDate } from './s3-signer';
import {
  StorageBackend,
  StorageConfigError,
  StorageReadRequest,
  StorageStat,
  StorageStream,
} from './storage.types';

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** MinIO 等自建服务需要 path-style：http://host/bucket/key */
  forcePathStyle: boolean;
  keyPrefix: string;
}

/**
 * S3 兼容对象存储后端（AWS S3 / MinIO / Cloudflare R2 / 阿里云 OSS 的 S3 兼容模式）。
 *
 * 只实现读路径：
 * - `openRead` 支持原生 Range（这是相对 Telegram 的关键收益：无需整段回源即可 seek）
 * - `stat` 走 HEAD 拿对象大小
 *
 * 不引入 AWS SDK：SigV4 在 s3-signer.ts 内实现并有 AWS 官方示例的向量测试，
 * 避免为一条读路径引入数十 MB 依赖与额外的凭据链行为。
 */
@Injectable()
export class S3StorageBackend implements StorageBackend {
  readonly id = 's3' as const;
  private readonly logger = new Logger(S3StorageBackend.name);

  constructor(private readonly configService: ConfigService) {}

  /** 读取并校验配置；缺失必填项时抛 StorageConfigError（而非静默回退）。 */
  private readConfig(): S3Config {
    const get = (key: string): string => (this.configService.get<string>(key) ?? '').trim();
    const bucket = get('S3_BUCKET');
    const accessKeyId = get('S3_ACCESS_KEY_ID');
    const secretAccessKey = get('S3_SECRET_ACCESS_KEY');
    const region = get('S3_REGION') || 'us-east-1';

    const missing = [
      ['S3_BUCKET', bucket],
      ['S3_ACCESS_KEY_ID', accessKeyId],
      ['S3_SECRET_ACCESS_KEY', secretAccessKey],
    ].filter(([, value]) => !value).map(([key]) => key);
    if (missing.length > 0) {
      throw new StorageConfigError(`S3 后端配置不完整，缺少：${missing.join('、')}`);
    }

    const forcePathStyleRaw = get('S3_FORCE_PATH_STYLE');
    // 未显式指定时：存在自定义 endpoint 就用 path-style（MinIO/R2 的常见形态），
    // 否则用 AWS 默认的 virtual-hosted-style。
    const customEndpoint = get('S3_ENDPOINT');
    const forcePathStyle = forcePathStyleRaw === ''
      ? Boolean(customEndpoint)
      : forcePathStyleRaw === 'true';
    const endpoint = customEndpoint || `https://s3.${region}.amazonaws.com`;

    return {
      endpoint: endpoint.replace(/\/+$/, ''),
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      sessionToken: get('S3_SESSION_TOKEN') || undefined,
      forcePathStyle,
      keyPrefix: get('S3_KEY_PREFIX').replace(/^\/+|\/+$/g, ''),
    };
  }

  isConfigured(): boolean {
    try {
      this.readConfig();
      return true;
    } catch {
      return false;
    }
  }

  /** 把对象 key 拼成完整 URL，并返回参与签名所需的主机与路径。 */
  private buildTarget(config: S3Config, key: string): { url: string; host: string; path: string } {
    const prefix = config.keyPrefix ? `${config.keyPrefix}/` : '';
    const objectPath = `/${config.bucket}/${prefix}${key}`;
    const endpointUrl = new URL(config.endpoint);
    const host = endpointUrl.host;
    if (config.forcePathStyle) {
      return { url: `${config.endpoint}${objectPath}`, host, path: objectPath };
    }
    // virtual-hosted-style：bucket 进主机名，路径只剩 key
    return {
      url: `${endpointUrl.protocol}//${config.bucket}.${host}${`/${prefix}${key}`}`,
      host: `${config.bucket}.${host}`,
      path: `/${prefix}${key}`,
    };
  }

  private sign(
    config: S3Config,
    method: 'GET' | 'HEAD',
    target: { host: string; path: string },
    extraHeaders: Record<string, string>,
  ): Record<string, string> {
    const amzDate = toAmzDate();
    const headers: Record<string, string> = {
      host: target.host,
      'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };
    if (config.sessionToken) headers['x-amz-security-token'] = config.sessionToken;

    const signed = signRequest({
      method,
      host: target.host,
      path: target.path,
      headers,
      payloadHash: EMPTY_PAYLOAD_SHA256,
      amzDate,
      region: config.region,
      service: 's3',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });

    const { host: _host, ...rest } = headers;
    return { ...rest, Authorization: signed.authorization };
  }

  async openRead(request: StorageReadRequest): Promise<StorageStream> {
    const config = this.readConfig();
    const key = String(request.key ?? '').trim();
    if (!key) throw new StorageConfigError('S3 读请求缺少 object key');

    const target = this.buildTarget(config, key);
    const extraHeaders: Record<string, string> = {};
    if (request.range) {
      if (!Number.isSafeInteger(request.range.start) || !Number.isSafeInteger(request.range.end)
        || request.range.start < 0 || request.range.end < request.range.start) {
        throw new StorageConfigError(`S3 非法字节区间：${JSON.stringify(request.range)}`);
      }
      extraHeaders.range = `bytes=${request.range.start}-${request.range.end}`;
    }

    const response = await fetch(target.url, {
      method: 'GET',
      headers: this.sign(config, 'GET', target, extraHeaders),
    });

    if (!response.ok || !response.body) {
      const bodyText = await response.text().catch(() => '');
      throw new Error(
        `S3 读取失败：status=${response.status} key=${key}${bodyText ? ` body=${bodyText.slice(0, 200)}` : ''}`,
      );
    }

    // Content-Range: bytes 0-9/1024 → 总大小在斜杠之后
    const contentRange = response.headers.get('content-range');
    const totalFromRange = contentRange?.includes('/')
      ? Number(contentRange.split('/')[1])
      : Number.NaN;
    const contentLength = Number(response.headers.get('content-length') ?? Number.NaN);
    const size = Number.isFinite(totalFromRange)
      ? totalFromRange
      : (request.expectedSize ?? (Number.isFinite(contentLength) ? contentLength : 0));

    this.logger.debug(
      `S3 读流 key=${key} range=${request.range ? `${request.range.start}-${request.range.end}` : 'full'} size=${size}`,
    );

    return {
      stream: Readable.fromWeb(response.body as never),
      info: { file_id: key, file_path: '', file_size: size },
    };
  }

  async stat(key: string): Promise<StorageStat> {
    const config = this.readConfig();
    const target = this.buildTarget(config, key);
    const response = await fetch(target.url, {
      method: 'HEAD',
      headers: this.sign(config, 'HEAD', target, {}),
    });
    if (response.status === 404) return { size: null };
    if (!response.ok) {
      throw new Error(`S3 stat 失败：status=${response.status} key=${key}`);
    }
    const length = Number(response.headers.get('content-length') ?? Number.NaN);
    return { size: Number.isFinite(length) ? length : null };
  }
}
