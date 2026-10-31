<template>
  <div>
    <div class="page-header">
      <h1>个人设置</h1>
      <p>管理您的账号信息</p>
    </div>

    <div class="card">
      <h3 style="margin-bottom: 24px; font-family: var(--font-display); font-size: 16px; font-weight: 600;">
        修改密码
      </h3>
      <t-form ref="passwordFormRef" :data="passwordForm" :rules="passwordRules" @submit="handlePasswordChange" label-align="top">
        <t-form-item label="原密码" name="oldPassword">
          <t-input v-model="passwordForm.oldPassword" type="password" placeholder="请输入原密码..." autocomplete="current-password" name="settings-old-pass" />
        </t-form-item>
        <t-form-item label="新密码" name="newPassword">
          <t-input v-model="passwordForm.newPassword" type="password" placeholder="请输入新密码（至少 6 位）..." autocomplete="new-password" name="settings-new-pass" />
        </t-form-item>
        <t-form-item label="确认新密码" name="confirmPassword">
          <t-input v-model="passwordForm.confirmPassword" type="password" placeholder="请再次输入新密码..." autocomplete="new-password" name="settings-confirm-pass" />
        </t-form-item>
        <t-form-item>
          <t-button type="submit" theme="primary" :loading="submitting" :disabled="submitting">保存修改</t-button>
        </t-form-item>
      </t-form>
    </div>

    <div class="card" style="margin-top: 20px;">
      <h3 style="margin-bottom: 24px; font-family: var(--font-display); font-size: 16px; font-weight: 600;">
        账号信息
      </h3>
      <t-descriptions :column="2" border>
        <t-descriptions-item label="邮箱">{{ authStore.user?.email }}</t-descriptions-item>
        <t-descriptions-item label="角色">
          <t-tag :theme="roleTheme" variant="light">{{ roleText }}</t-tag>
        </t-descriptions-item>
        <t-descriptions-item label="邮箱验证">
          <span :class="authStore.user?.emailVerified ? 'status-verified' : 'status-unverified'">
            {{ authStore.user?.emailVerified ? '已验证' : '未验证' }}
          </span>
        </t-descriptions-item>
        <t-descriptions-item label="注册时间">
          {{ formatDate(authStore.user?.createdAt ?? '') }}
        </t-descriptions-item>
      </t-descriptions>
    </div>

    <div class="card" style="margin-top: 20px;">
      <h3 style="margin-bottom: 24px; font-family: var(--font-display); font-size: 16px; font-weight: 600;">
        存储配额
      </h3>
      <t-loading :loading="quotaLoading" size="small">
        <template v-if="quota">
          <template v-if="quota.unlimited">
            <p class="quota-note">当前账号不限量，已使用 {{ formatSize(quota.usedBytes) }}。</p>
          </template>
          <template v-else>
            <div class="quota-row">
              <span>已使用 <strong>{{ formatSize(quota.usedBytes) }}</strong> / {{ formatSize(quota.quotaBytes ?? 0) }}</span>
              <span>剩余 {{ formatSize(quota.remainingBytes ?? 0) }}</span>
            </div>
            <t-progress
              :percentage="quotaPercent"
              :theme="quotaPercent >= 90 ? 'danger' : 'primary'"
              :label="false"
            />
            <p v-if="quotaPercent >= 90" class="quota-note quota-note--warn">
              配额即将用尽，超出后上传会被拒绝。可删除文件或联系管理员调整配额。
            </p>
          </template>
        </template>
        <p v-else class="quota-note">暂无配额信息</p>
      </t-loading>
    </div>

    <div class="card" style="margin-top: 20px;">
      <ApiKeyManager />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import MessagePlugin from '@/utils/message';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../stores/auth';
import { getErrorMessage } from '../../utils/error';
import type { UserRole } from '../../types/user';
import ApiKeyManager from '../../components/settings/ApiKeyManager.vue';
import { getMyStorageQuota, type StorageQuotaSummary } from '../../api/quota';
import { formatSize } from '../../utils/format';

const authStore = useAuthStore();

const passwordFormRef = ref();

const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});

/** G11-18：提交中状态，防止重复提交 */
const submitting = ref(false);

/** 密码强度校验：至少包含大写、小写、数字、特殊字符中的 3 类（G11-18） */
function passwordStrengthValid(pwd: string): boolean {
  if (!pwd || pwd.length < 6) return false;
  let classes = 0;
  if (/[a-z]/.test(pwd)) classes++;
  if (/[A-Z]/.test(pwd)) classes++;
  if (/[0-9]/.test(pwd)) classes++;
  if (/[^A-Za-z0-9]/.test(pwd)) classes++;
  return classes >= 3;
}

const passwordRules = {
  oldPassword: [{ required: true, message: '请输入原密码' }],
  newPassword: [
    { required: true, message: '请输入新密码' },
    { min: 6, message: '密码至少6位' },
    {
      validator: (val: string) => passwordStrengthValid(val),
      message: '密码需至少包含大写字母、小写字母、数字、特殊字符中的 3 类',
    },
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码' },
    {
      validator: (val: string) => val === passwordForm.newPassword,
      message: '两次密码不一致',
    },
  ],
};

/** 存储配额：后端按 files 实时汇总，前端只展示（不缓存到 store，避免过期） */
const quota = ref<StorageQuotaSummary | null>(null);
const quotaLoading = ref(true);

/** 用量百分比：不限量或无配额时为 0；上限为 0 理论上不会出现（0 表示不限） */
const quotaPercent = computed(() => {
  const q = quota.value;
  if (!q || q.unlimited || !q.quotaBytes) return 0;
  return Math.min(100, Math.round((q.usedBytes / q.quotaBytes) * 100));
});

async function loadQuota() {
  quotaLoading.value = true;
  try {
    quota.value = await getMyStorageQuota();
  } catch (error) {
    // 配额查询失败不应阻塞设置页其余功能，仅提示一次
    MessagePlugin.error(getErrorMessage(error) || '获取存储配额失败');
  } finally {
    quotaLoading.value = false;
  }
}

onMounted(loadQuota);

const roleText = computed(() => {
  const map: Record<UserRole, string> = { super_admin: '超级管理员', admin: '管理员', user: '普通用户' };
  return map[authStore.user?.role ?? 'user'] || '普通用户';
});

const roleTheme = computed(() => {
  const map: Record<UserRole, string> = { super_admin: 'warning', admin: 'primary', user: 'default' };
  return map[authStore.user?.role ?? 'user'] || 'default';
});

function formatDate(date: string) {
  return date ? new Date(date).toLocaleDateString('zh-CN') : '-';
}

async function handlePasswordChange() {
  if (submitting.value) return;
  const valid = await passwordFormRef.value?.validate();
  if (valid !== true) return;
  if (!authStore.user) {
    MessagePlugin.error('用户信息缺失，请重新登录');
    return;
  }
  submitting.value = true;
  try {
    await api.put('/users/me/password', {
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword,
    });
    MessagePlugin.success('密码修改成功');
    passwordFormRef.value?.reset();
  } catch (error: unknown) {
    MessagePlugin.error(getErrorMessage(error));
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.status-verified {
  color: var(--color-success);
  font-weight: 500;
}

.status-unverified {
  color: var(--text-tertiary);
}
.quota-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--text-muted, #8b93a7);
}

.quota-note {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-muted, #8b93a7);
}

.quota-note--warn {
  color: var(--warning-color, #e37318);
}
</style>
