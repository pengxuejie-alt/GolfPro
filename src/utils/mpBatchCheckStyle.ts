/**
 * 比赛列表「管理」多选框：内联 style，白底 + 灰色边框；对勾颜色见 MP_BATCH_CHECK_ICON_COLOR。
 */
/** 边框颜色（slate-400） */
export const MP_BATCH_CHECK_BORDER_COLOR = '#94a3b8';
/** 对勾颜色（slate-500），略深于边框以便辨认 */
export const MP_BATCH_CHECK_ICON_COLOR = '#64748b';

const MP_BATCH_CHECK_BASE =
  `width:52rpx;height:52rpx;border-radius:12rpx;box-sizing:border-box;display:flex;align-items:center;justify-content:center;flex-shrink:0;background-color:#ffffff;border:4rpx solid ${MP_BATCH_CHECK_BORDER_COLOR};position:relative;z-index:60;`;

export const MP_BATCH_CHECK_OFF = MP_BATCH_CHECK_BASE;
export const MP_BATCH_CHECK_ON = MP_BATCH_CHECK_BASE;