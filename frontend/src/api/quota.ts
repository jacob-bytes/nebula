import api from './client';

/** 与后端 QuotaService.StorageQuotaSummary 对齐的配额视图。 */
export interface StorageQuotaSummary {
  /** 已占用字节数（只统计未删除文件） */
  usedBytes: number;
  /** 生效配额字节数；null 表示不限 */
  quotaBytes: number | null;
  /** 剩余字节数；不限时为 null */
  remainingBytes: number | null;
  unlimited: boolean;
}

/** 当前登录用户的存储配额与用量。 */
export async function getMyStorageQuota(): Promise<StorageQuotaSummary> {
  // 统一响应包装为 { code, message, data }，拦截器校验业务码但不解包，这里取 data.data
  const response = await api.get('/quota');
  return response.data.data as StorageQuotaSummary;
}
