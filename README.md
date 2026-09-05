# 家庭菜单微信小程序

这是家庭菜单后端的微信小程序前端，当前页面包含三条 MVP 主流程：

- 点菜：按分类浏览可供应菜品，调整数量并提交订单
- 订单：查看历史点菜记录和订单备注
- 家庭：创建家庭、查看成员、添加或移除成员

## 本地联调

1. 在微信开发者工具中导入本目录，使用 `project.config.json` 中的 AppID。
2. 启动后端：在 `/Users/workspace/family-menu-backend` 执行 `mvn spring-boot:run -Dspring-boot.run.profiles=memory`。内存模式提供开发用登录接口，数据会在重启后清空。
3. 开发者工具的“详情 -> 本地设置”勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”。
4. 默认接口地址在 `app.js` 的 `globalData.apiBaseUrl`，开发者工具访问本机时保持 `http://localhost:8081`；真机调试时改为电脑局域网 IP，例如 `http://192.168.1.10:8081`。

后端返回统一的 `{ success, message, data }` 结构，页面请求层会自动提取 `data` 并展示后端错误信息。生产环境需要把接口切换为 HTTPS，并在微信公众平台配置 request 合法域名。

家庭邀请使用 6 位邀请码。数据库升级时，在已执行会话和订单迁移后，再执行后端目录下的 `src/main/resources/migration-family-invitation.sql`。
