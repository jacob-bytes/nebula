# 存储抽象

文件本体的读写位置由存储后端决定。当前版本用一层端口把**读路径**从 Telegram 解耦，
写入仍由 Telegram 链路承担（上传选号、账号池、镜像等语义与 Telegram 强绑定）。

## 数据模型

`files` 表新增两列（见迁移 `1804100000000`）：

| 列 | 含义 |
|---|---|
| `storageProvider` | `telegram` / `s3`；**空值表示存量数据，按 Telegram 处理** |
| `storageKey` | 对象存储内的 key（仅 `s3` 时有意义） |

空值语义是关键：所有历史文件的行为与改造前**逐字节一致**，不需要回填。

## 代码结构

```text
backend/src/storage/
├── storage.types.ts              StorageBackend 端口、错误类型
├── s3-signer.ts                  SigV4 签名（AWS 官方示例向量测试）
├── s3-storage.backend.ts         S3 兼容读后端（GET/HEAD，原生 Range）
├── telegram-storage.backend.ts   Telegram 读后端（适配既有 getRealtimeFileStream）
├── storage.service.ts            按 storageProvider 分派
└── storage.module.ts             装配与启动自检
```

读路径接入点只有一个：`FileService.openUpstreamStream()`。当
`storageProvider` 为空或 `telegram` 时，调用原来的 `openTelegramSourceStream()`
（账号池选号、副本、镜像逻辑全部不变）；显式标记为 `s3` 时才走对象存储。

## 配置

见 `backend/.env.example` 的「对象存储」段：

```bash
S3_ENDPOINT=https://minio.local:9000   # 自建/兼容服务；AWS 可留空
S3_REGION=us-east-1
S3_BUCKET=nebula
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=                   # 留空时：有自定义 endpoint 则为 true
S3_KEY_PREFIX=nebula
```

不引入 AWS SDK：SigV4 在 `s3-signer.ts` 内实现，并用 AWS 文档中的
`GET Object` 示例做已知向量测试（签名逐字节比对）。

## 把一个文件切到 S3

写入路径尚未迁移，因此目前是「运维/脚本显式迁移」模型：

1. 把对象上传到 bucket（key 与 `storageKey` 一致）；
2. 更新记录：

```sql
UPDATE files
   SET "storageProvider" = 's3',
       "storageKey" = 'nebula/<key>'
 WHERE id = '<file-id>';
```

3. 首次读取即走 S3；回退只需把两列置回 `NULL`。

> 只适合已确认对象就位的文件。若对象不存在，读取会返回 5xx 并记录
> `S3 读取失败：status=404`，不会静默回退到 Telegram——避免读到不一致的内容。

## 为什么不一次做到写路径

上传链路涉及：账号池加权选号、主副本锚点、镜像任务、副本扩散、
`file_unique_id` 归属校验。这些概念在对象存储上没有对应物，
一次性替换会把「加一个新后端」变成「重写上传调度」。当前拆法让读路径先解耦，
写入等对象存储真正启用后再按同样的端口补 `put/delete`。
