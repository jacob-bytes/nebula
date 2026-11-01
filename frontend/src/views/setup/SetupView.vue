<template>
  <div class="setup-page">
    <div class="setup-card">
      <header class="setup-head">
        <div class="setup-mark" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 2L17 6v8l-7 4-7-4V6l7-4z" />
            <path d="M10 10l7-4M10 10v8M10 10L3 6" />
          </svg>
        </div>
        <h1>初始化星云盘</h1>
        <p>三步完成配置。安装令牌在安装脚本的终端输出里，也可在服务器上查看 .setup-token 文件。</p>
      </header>

      <!-- 已完成 / 不可用状态 -->
      <div v-if="state !== 'form'" class="setup-result">
        <t-icon :name="state === 'done' ? 'check-circle' : 'error-circle'" size="28px" />
        <p class="result-title">{{ resultTitle }}</p>
        <p class="result-desc">{{ resultDesc }}</p>
        <t-button v-if="state === 'done'" theme="primary" @click="reload">刷新进入登录页</t-button>
      </div>

      <template v-else>
        <div class="setup-token">
          <label for="setup-token">安装令牌</label>
          <t-input
            id="setup-token"
            v-model="form.setupToken"
            placeholder="安装脚本输出的一次性令牌"
            autocomplete="off"
          />
        </div>

        <!-- 自绘步骤条：为三个步骤引入 TDesign Steps 组件会带来十余 KB CSS，
             而这里只需要「当前第几步 + 标题」 -->
        <ol class="setup-steps" aria-label="初始化步骤">
          <li
            v-for="(item, index) in stepOptions"
            :key="item.title"
            class="setup-step"
            :class="{ current: index === step, done: index < step }"
            :aria-current="index === step ? 'step' : undefined"
          >
            <span class="step-dot">{{ index + 1 }}</span>
            <span class="step-title">{{ item.title }}</span>
          </li>
        </ol>

        <!-- 第 1 步：站点 -->
        <section v-show="step === 0" class="setup-panel">
          <label class="field">
            <span class="field-label">站点名称</span>
            <t-input v-model="form.siteTitle" placeholder="星云盘" />
          </label>
          <label class="field">
            <span class="field-label">站点访问地址</span>
            <t-input v-model="form.appUrl" placeholder="https://pan.example.com" />
            <span class="field-hint">用于分享链接与邮件里的绝对地址；以 https 开头会自动开启安全 Cookie。</span>
          </label>
        </section>

        <!-- 第 2 步：Telegram -->
        <section v-show="step === 1" class="setup-panel">
          <label class="field">
            <span class="field-label">Bot Token</span>
            <t-input v-model="form.telegramBotToken" placeholder="123456:ABC-DEF..." autocomplete="off" />
          </label>
          <label class="field">
            <span class="field-label">存储 Chat ID</span>
            <t-input v-model="form.telegramChatId" placeholder="-1001234567890" autocomplete="off" />
            <span class="field-hint">把 Bot 拉进一个私有群/频道，授予发言权限后获取该 ID；格式为负数，超级群/频道以 <code>-100</code> 开头（如 <code>-1001234567890</code>）。</span>
          </label>
          <div class="setup-test">
            <t-button theme="default" variant="outline" :loading="testing" @click="testTelegram">
              发送测试消息
            </t-button>
            <span v-if="testResult" class="test-result" :class="{ ok: testResult.ok }">{{ testResult.text }}</span>
          </div>
        </section>

        <!-- 第 3 步：管理员 -->
        <section v-show="step === 2" class="setup-panel">
          <label class="field">
            <span class="field-label">管理员邮箱</span>
            <t-input v-model="form.adminEmail" placeholder="admin@example.com" autocomplete="off" />
          </label>
          <label class="field">
            <span class="field-label">管理员密码</span>
            <t-input v-model="form.adminPassword" type="password" placeholder="至少 8 位" autocomplete="new-password" />
            <span class="field-hint">该账号将成为超级管理员；系统完成初始化后此向导永久关闭。</span>
          </label>
        </section>

        <p v-if="error" class="setup-error">{{ error }}</p>

        <footer class="setup-actions">
          <t-button v-if="step > 0" theme="default" variant="text" @click="step -= 1">上一步</t-button>
          <t-button v-if="step < 2" theme="primary" :disabled="!canAdvance" @click="step += 1">下一步</t-button>
          <t-button v-else theme="primary" :loading="submitting" @click="submit">完成初始化</t-button>
        </footer>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../stores/auth';
import { getErrorMessage } from '../../utils/error';

/**
 * 首次运行向导。
 *
 * 设计取向：
 * - 安装脚本零提问，配置全部在这里完成（含「发送测试消息」验证 chat id）；
 * - 写操作都要一次性安装令牌：未初始化的实例一旦暴露公网，没有令牌就可能被抢先接管；
 * - 提交成功后后端会重启进程（systemd Restart），所以这里只提示刷新，不轮询。
 */

const step = ref(0);
const submitting = ref(false);
const testing = ref(false);
const error = ref('');
const testResult = ref<{ ok: boolean; text: string } | null>(null);
const state = ref<'form' | 'done' | 'unavailable'>('form');

const stepOptions = [{ title: '站点' }, { title: 'Telegram' }, { title: '管理员' }];

const form = reactive({
  setupToken: '',
  siteTitle: '星云盘',
  appUrl: `${window.location.protocol}//${window.location.host}`,
  telegramBotToken: '',
  telegramChatId: '',
  adminEmail: '',
  adminPassword: '',
});

const resultTitle = computed(() => (state.value === 'done' ? '初始化完成' : '向导不可用'));
const resultDesc = computed(() => (state.value === 'done'
  ? '服务正在用新配置重启，几秒后刷新页面即可登录。'
  : '该系统已经完成初始化，或安装脚本未生成 .setup-token。请直接登录；如需重新配置，请修改服务器上的 .env。'));

const canAdvance = computed(() => {
  if (!form.setupToken.trim()) return false;
  if (step.value === 0) return form.appUrl.trim().length > 0;
  if (step.value === 1) {
    return /^\d+:[\w-]+$/.test(form.telegramBotToken.trim())
      && /^-\d+$/.test(form.telegramChatId.trim());
  }
  return form.adminEmail.includes('@') && form.adminPassword.length >= 8;
});

async function testTelegram(): Promise<void> {
  testing.value = true;
  testResult.value = null;
  try {
    const response = await api.post('/setup/test-telegram', {
      setupToken: form.setupToken.trim(),
      botToken: form.telegramBotToken.trim(),
      chatId: form.telegramChatId.trim() || undefined,
    });
    const data = response.data.data as { botUsername: string; messageSent: boolean };
    testResult.value = {
      ok: true,
      text: `连接成功${data.botUsername ? `：@${data.botUsername}` : ''}${data.messageSent ? '，测试消息已发送' : ''}`,
    };
  } catch (err: unknown) {
    testResult.value = { ok: false, text: getErrorMessage(err) || '连接失败' };
  } finally {
    testing.value = false;
  }
}

async function submit(): Promise<void> {
  error.value = '';
  submitting.value = true;
  try {
    await api.post('/setup/complete', {
      setupToken: form.setupToken.trim(),
      siteTitle: form.siteTitle.trim() || '星云盘',
      appUrl: form.appUrl.trim(),
      telegramBotToken: form.telegramBotToken.trim(),
      telegramChatId: form.telegramChatId.trim(),
      adminEmail: form.adminEmail.trim(),
      adminPassword: form.adminPassword,
    });
    state.value = 'done';
  } catch (err: unknown) {
    error.value = getErrorMessage(err) || '初始化失败';
  } finally {
    submitting.value = false;
  }
}

function reload(): void {
  window.location.href = '/login';
}

onMounted(async () => {
  try {
    const response = await api.get('/setup/status');
    const status = response.data.data as { available: boolean; initialized: boolean };
    if (status.initialized) {
      state.value = 'unavailable';
    } else if (!status.available) {
      state.value = 'unavailable';
    }
  } catch {
    // 状态接口失败时不阻塞：让用户尝试填写，提交时会再校验一次
  }
});
</script>

<style scoped>
.setup-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  background: var(--background);
}

.setup-card {
  width: min(560px, 100%);
  padding: 28px;
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-default);
  background: var(--card);
  box-shadow: var(--shadow-lg);
}

.setup-head {
  text-align: center;
  margin-bottom: 20px;
}

.setup-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--primary);
  color: #fff;
  margin-bottom: 12px;
}

.setup-head h1 {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 6px;
}

.setup-head p {
  font-size: 13px;
  color: var(--text-tertiary);
  line-height: 1.6;
}

.setup-token {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 18px;
}

.setup-token label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.setup-steps {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
  list-style: none;
  padding: 0;
}

.setup-step {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  font-size: 12px;
  color: var(--text-tertiary);
}

.step-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: none;
  border-radius: 50%;
  border: 1px solid var(--border-default);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.setup-step.current .step-dot {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.setup-step.current .step-title {
  color: var(--text-primary);
  font-weight: 600;
}

.setup-step.done .step-dot {
  border-color: var(--primary);
  color: var(--primary);
}

.setup-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 168px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
}

.field-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}

.setup-test {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.test-result {
  font-size: 12px;
  color: var(--color-danger);
}

.test-result.ok {
  color: var(--color-success);
}

.setup-error {
  margin-top: 12px;
  font-size: 13px;
  color: var(--color-danger);
}

.setup-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}

.setup-result {
  text-align: center;
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.result-title {
  font-size: 16px;
  font-weight: 600;
}

.result-desc {
  font-size: 13px;
  color: var(--text-tertiary);
  line-height: 1.6;
  max-width: 420px;
}
</style>
