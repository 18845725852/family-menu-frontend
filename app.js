App({
  globalData: {
    // 开发者工具可直接访问本机；真机调试时改成电脑局域网 IP。
    apiBaseUrl: 'http://localhost:8081',
    familyId: null,
    family: null
  },
  onLaunch() {
    const familyId = wx.getStorageSync('familyId')
    if (familyId) this.globalData.familyId = familyId
  }
})
