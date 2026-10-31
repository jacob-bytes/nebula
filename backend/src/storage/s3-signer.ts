import { createHash, createHmac } from 'crypto';

/** 参与签名的最小请求描述。 */
export interface SigV4Request {
  method: string;
  /** 主机名（含端口时一并写入 Host 头） */
  host: string;
  /** 已解码的路径，例如 /bucket/key */
  path: string;
  /** 已解码的查询参数；无则为空对象 */
  query?: Record<string, string>;
  /** 参与签名的请求头（键名大小写不敏感，内部统一转小写） */
  headers: Record<string, string>;
  /** 空请求体用 SHA256('') */
  payloadHash: string;
  /** 例如 20261031T120000Z */
  amzDate: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SigV4Result {
  /** 可直接并入请求头的 Authorization 值 */
  authorization: string;
  /** 规范化请求，便于单测与排障 */
  canonicalRequest: string;
  signature: string;
  scope: string;
}

/** RFC 3986 编码：S3 的 canonical URI/query 要求空格编码为 %20 且保留 '/'。 */
export function uriEncode(value: string, encodeSlash = true): string {
  return value
    .split('')
    .map((char) => {
      if (/[A-Za-z0-9_.~-]/.test(char)) return char;
      if (char === '/' && !encodeSlash) return char;
      return Array.from(Buffer.from(char, 'utf8'))
        .map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)
        .join('');
    })
    .join('');
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** 生成 SigV4 的 Authorization 头。用于 S3 的 GET/HEAD/PUT/DELETE。 */
export function signRequest(request: SigV4Request): SigV4Result {
  const method = request.method.toUpperCase();
  const canonicalUri = request.path
    .split('/')
    .map((segment) => uriEncode(segment))
    .join('/') || '/';

  const query = request.query ?? {};
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((key) => `${uriEncode(key)}=${uriEncode(query[key])}`)
    .join('&');

  // 头名小写、按字典序，值做多余空白折叠
  const headerEntries = Object.entries(request.headers)
    .map(([key, value]) => [key.toLowerCase().trim(), String(value).replace(/\s+/g, ' ').trim()] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalHeaders = headerEntries.map(([key, value]) => `${key}:${value}\n`).join('');
  const signedHeaders = headerEntries.map(([key]) => key).join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    request.payloadHash,
  ].join('\n');

  const date = request.amzDate.slice(0, 8);
  const scope = `${date}/${request.region}/${request.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    request.amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${request.secretAccessKey}`, date), request.region), request.service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${request.accessKeyId}/${scope}, `
      + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest,
    signature,
    scope,
  };
}

/** 空请求体的固定摘要（GET/HEAD/DELETE 常用）。 */
export const EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** 生成 x-amz-date 形式的时间戳。 */
export function toAmzDate(date: Date = new Date()): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}
