function readNavMetrics() {
  try {
    const windowInfo = (wx.getWindowInfo && wx.getWindowInfo()) || wx.getSystemInfoSync() || {}
    const menu = (wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect()) || {}
    const statusBarHeight = windowInfo.statusBarHeight || 47
    const menuHeight = menu.height || 32
    const menuTop = menu.top || (statusBarHeight + 4)
    const menuBottom = menu.bottom || (menuTop + menuHeight)
    const windowWidth = windowInfo.windowWidth || 375
    const menuLeft = menu.left || (windowWidth - 96)
    return {
      statusBarHeight: statusBarHeight,
      navBarHeight: Math.max((menuTop - statusBarHeight) * 2 + menuHeight, menuHeight + 8),
      headerTop: menuBottom + 10,
      capsuleRightGap: Math.max(windowWidth - menuLeft + 8, 96)
    }
  } catch (e) {
    return {
      statusBarHeight: 47,
      navBarHeight: 44,
      headerTop: 98,
      capsuleRightGap: 96
    }
  }
}

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
    family: null,
    navMetrics: null
  },
  getNavMetrics() {
    if (!this.globalData.navMetrics) this.globalData.navMetrics = readNavMetrics()
    return this.globalData.navMetrics
  },
  onLaunch() {
    this.getNavMetrics()
    const familyId = wx.getStorageSync('familyId')
    if (familyId) this.globalData.familyId = familyId
    const token = wx.getStorageSync('sessionToken')
    const user = wx.getStorageSync('currentUser')
    if (token) this.globalData.sessionToken = token
    if (user) this.globalData.currentUser = user
  }
})
