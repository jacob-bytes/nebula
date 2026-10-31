/**
 * 品牌常量（后端唯一事实源，由 scripts/rename-brand.mjs 生成，勿手改）。
 *
 * 凡是会出现在用户视野里的产品标识都应从这里取：
 * 站点标题、API Key 前缀、错误码响应头、SQLite 默认文件名。
 */
/** 品牌信息形状。字段刻意声明为 string（而非字面量类型），
 * 否则 const DEFAULT_SITE_TITLE = BRAND_SITE_TITLE 会被窄化成字面量，
 * 后续把后台配置的任意字符串赋给同一变量时类型不兼容。 */
export interface BrandInfo {
  /** 小写标识：用于 package 名、文件路径、API Key 前缀、systemd 单元名 */
  readonly slug: string;
  /** 中文站点名：页面标题、邮件主题、默认 SITE_TITLE */
  readonly nameZh: string;
  /** 英文名：对外文档与英文界面 */
  readonly nameEn: string;
}

export const BRAND: BrandInfo = {
  slug: 'nebula',
  nameZh: '星云盘',
  nameEn: 'Nebula',
};

export const BRAND_SLUG: string = BRAND.slug;
export const BRAND_SITE_TITLE: string = BRAND.nameZh;
export const BRAND_API_KEY_PREFIX: string = BRAND.slug;
/** 业务错误码响应头：前端排队/退避逻辑依赖该名字，两端必须一致。 */
export const BRAND_ERROR_CODE_HEADER =
  'X-' + BRAND.slug.charAt(0).toUpperCase() + BRAND.slug.slice(1) + '-Error-Code';
