/**
 * 品牌常量（前端唯一事实源，由 scripts/rename-brand.mjs 生成，勿手改）。
 *
 * 与 backend/src/common/brand.ts 保持同名同值；错误码响应头必须与后端逐字符一致。
 */
export interface BrandInfo {
  readonly slug: string;
  readonly nameZh: string;
  readonly nameEn: string;
}

export const BRAND: BrandInfo = {
  slug: 'nebula',
  nameZh: '星云盘',
  nameEn: 'Nebula',
};

export const BRAND_SITE_TITLE: string = BRAND.nameZh;
export const BRAND_ERROR_CODE_HEADER = 'x-' + BRAND.slug + '-error-code';
