/**
 * 记分卡海报等保存到系统相册；处理 scope.writePhotosAlbum 拒绝后的设置引导。
 * 所有分支 try-catch / fail，避免模拟器或未点隐私同意时未捕获异常卡死。
 */

export function openAlbumPermissionGuide(): void {
  try {
    uni.showModal({
      title: '需要相册权限',
      content: '请在设置中开启「保存到相册」，用于保存记分卡海报。',
      confirmText: '去设置',
      cancelText: '取消',
      success: (res) => {
        try {
          if (res.confirm) {
            uni.openSetting({
              fail: (e) => console.warn('[savePoster] openSetting fail', e),
            });
          }
        } catch (e) {
          console.warn('[savePoster] openSetting', e);
        }
      },
      fail: (e) => console.warn('[savePoster] showModal fail', e),
    });
  } catch (e) {
    console.warn('[savePoster] openAlbumPermissionGuide', e);
  }
}

/**
 * 将本地临时路径或包内图片保存到相册。
 */
export async function saveImageToPhotosAlbumSafe(filePath: string): Promise<boolean> {
  if (!filePath) return false;
  try {
    await new Promise<void>((resolve, reject) => {
      uni.saveImageToPhotosAlbum({
        filePath,
        success: () => resolve(),
        fail: (e) => reject(e),
      });
    });
    try {
      uni.showToast({ title: '已保存到相册', icon: 'success' });
    } catch {
      /* ignore */
    }
    return true;
  } catch (e: unknown) {
    const err = e as { errMsg?: string; errno?: number };
    const msg = err?.errMsg || String(e);
    if (
      msg.includes('auth deny') ||
      msg.includes('authorize') ||
      msg.includes('permission') ||
      err?.errno === 103
    ) {
      openAlbumPermissionGuide();
    } else {
      try {
        uni.showToast({ title: '保存失败', icon: 'none' });
      } catch {
        /* ignore */
      }
    }
    console.warn('[savePoster] saveImageToPhotosAlbumSafe', e);
    return false;
  }
}

/**
 * 将 static 下资源先 getImageInfo 再保存（小程序包内路径）。
 */
export async function savePackagedImageToAlbum(relativePath: string): Promise<boolean> {
  try {
    const path = await new Promise<string>((resolve, reject) => {
      uni.getImageInfo({
        src: relativePath,
        success: (r) => resolve(r.path),
        fail: (e) => reject(e),
      });
    });
    return await saveImageToPhotosAlbumSafe(path);
  } catch (e) {
    console.warn('[savePoster] savePackagedImageToAlbum', e);
    try {
      uni.showToast({ title: '无法读取图片', icon: 'none' });
    } catch {
      /* ignore */
    }
    return false;
  }
}
