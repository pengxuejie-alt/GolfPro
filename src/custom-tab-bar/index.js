/** 与 pages.json tabBar.list 的 pagePath、图标路径一致 */
const TAB_LIST = [
  {
    pagePath: 'pages/index/index',
    text: '首页',
    icon: '/static/tab/home.png',
    iconActive: '/static/tab/home-active.png',
  },
  {
    pagePath: 'pages/Players',
    text: '球友',
    icon: '/static/tab/players.png',
    iconActive: '/static/tab/players-active.png',
  },
  {
    pagePath: 'pages/Me',
    text: '我的',
    icon: '/static/tab/me.png',
    iconActive: '/static/tab/me-active.png',
  },
];

/** 与 app.json tabBar.list.pagePath 完全一致，勿加前导 /（否则部分基础库对 pages/index/index 报 no-tabBar） */
function switchTabUrl(path) {
  return String(path || '').replace(/^\//, '');
}

Component({
  data: {
    selected: 0,
    list: TAB_LIST,
  },
  methods: {
    goHome() {
      this._switchTab(0);
    },
    goPlayers() {
      this._switchTab(1);
    },
    goMe() {
      this._switchTab(2);
    },
    _switchTab(index) {
      const item = TAB_LIST[index];
      if (!item) return;
      this.setData({ selected: index });
      const url = switchTabUrl(item.pagePath);
      wx.switchTab({
        url,
        fail: (err) => {
          console.warn('[custom-tab-bar] switchTab fail', index, url, err);
          if (index === 0) {
            wx.reLaunch({ url: `/${url}` });
          }
        },
      });
    },
  },
});
