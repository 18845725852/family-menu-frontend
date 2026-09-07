App({
  globalData: {
    // 开发者工具可直接访问本机；真机调试时改成电脑局域网 IP。
    apiBaseUrl: 'https://api.familymenu.ink',
    // apiBaseUrl: 'http://localhost:8081',
    currentUser: null,
    pendingBasket: [],
    orderEditing: false,
    orderSubmitted: false,
    familyId: null,
    family: null
  },
  onLaunch() {
    const familyId = wx.getStorageSync('familyId')
    if (familyId) this.globalData.familyId = familyId
    const token = wx.getStorageSync('sessionToken')
    const user = wx.getStorageSync('currentUser')
    if (token) this.globalData.sessionToken = token
    if (user) this.globalData.currentUser = user
  }
})
