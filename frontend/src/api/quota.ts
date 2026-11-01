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

/**
 * 管理员视角的用户配额。
 *
 * 注意：后端返回的是与 /quota 相同的 StorageQuotaSummary，「继承默认 vs 显式设置」的
 * 区分来自用户列表行的 storageQuotaBytes（NULL=继承，0=不限），不需要额外字段。
 */
export type AdminUserQuota = StorageQuotaSummary;

/** 查询指定用户的配额与用量。 */
export async function getUserQuota(userId: string): Promise<AdminUserQuota> {
  const response = await api.get(`/admin/users/${userId}/quota`);
  return response.data.data as AdminUserQuota;
}

/**
 * 设置单个用户的配额。
 * quotaBytes：null=恢复继承默认，0=不限，其余为字节数。
 */
export async function setUserQuota(userId: string, quotaBytes: number | null): Promise<AdminUserQuota> {
  const response = await api.put(`/admin/users/${userId}/quota`, { quotaBytes });
  return response.data.data as AdminUserQuota;
}

/** 批量设置（≤500 个用户）。 */
export async function setUsersQuotaBatch(userIds: string[], quotaBytes: number | null): Promise<number> {
  const response = await api.put('/admin/users/quota/batch', { userIds, quotaBytes });
  const payload = response.data.data as { updated?: number } | number;
  return typeof payload === 'number' ? payload : Number(payload?.updated ?? 0);
}
