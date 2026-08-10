/**
 * 微信小程序包内 static 资源路径。
 *
 * 源码里不要直接写 `'/static/foo.png'` 字符串：@dcloudio/vite-plugin-uni 等链路
 * 会把其改写成相对路径（如 `../../static/foo.png`），在计分页会解析成
 * `/pages/scorecard/static/foo.png`，渲染层 500，canvas / getImageInfo 异常。
 *
 * 用 Unicode 形式的 `/` 避免被静态分析当作模块/资源重写。
 */
export function mpStaticAbsolute(fileName: string): string {
  const n = String(fileName || '').replace(/^\//, '');
  return `\u002Fstatic\u002F${n}`;
}
