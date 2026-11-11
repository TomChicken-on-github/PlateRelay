# 2.2a · 接口和规则对照

> 属于 [文档 2](README.md)。接口契约 [openapi.yaml](../../../packages/shared/schema/openapi.yaml) 放在代码目录里，里面不写文档编号（代码要能脱离设计文档读懂）。每个接口对应哪些规则和状态转换记在这里；改接口时两边一起改。

| 操作 ID | 方法和路径 | 相关规则 | 可能触发的状态转换 |
| --- | --- | --- | --- |
| `getAuthMethods` | `GET /auth/methods` | R-ACC-01 |  |
| `setup` | `POST /setup` |  |  |
| `login` | `POST /auth/login` | R-ACC-04、API-RATE-01、API-AUTH-06 |  |
| `logout` | `POST /auth/logout` |  |  |
| `issueCaptcha` | `POST /auth/captcha` |  |  |
| `sendOtp` | `POST /auth/otp` | R-ACC-02、R-ACC-03、API-RATE-02 |  |
| `register` | `POST /auth/register` | R-ACC-01 |  |
| `oidcStart` | `GET /auth/oidc/{provider}/start` |  |  |
| `oidcCallback` | `GET /auth/oidc/{provider}/callback` |  |  |
| `getMe` | `GET /me` |  |  |
| `updateMe` | `PATCH /me` |  |  |
| `changePassword` | `PUT /me/password` |  |  |
| `setAvatar` | `PUT /me/avatar` |  |  |
| `getNotificationPrefs` | `GET /me/notification-prefs` | R-NTF-02 |  |
| `setNotificationPrefs` | `PUT /me/notification-prefs` | R-NTF-02 |  |
| `uploadFile` | `POST /files` | R-SUB-01、R-SUB-02、R-SUB-10、R-SUB-13、API-FILE-01 |  |
| `getFileCheck` | `GET /files/{fileId}/check` |  |  |
| `submitOrders` | `POST /orders` | R-SUB-02、R-SUB-05、R-SUB-06、R-SUB-07、R-SUB-08、R-SUB-09、R-ARB-05 | S-ORD-T01 |
| `listOrders` | `GET /orders` |  |  |
| `listMyOrders` | `GET /orders/mine` |  |  |
| `getOrder` | `GET /orders/{orderId}` |  |  |
| `listOrderRecords` | `GET /orders/{orderId}/records` | R-NTE-01、R-NTE-02、R-VIS-07 |  |
| `addDeviceStopNote` | `POST /orders/{orderId}/records` | R-NTE-01、R-NTE-03 |  |
| `downloadVersionFile` | `GET /orders/{orderId}/versions/{n}/file` | R-FIL-01 |  |
| `getOrderParts` | `GET /orders/{orderId}/parts` |  |  |
| `approveOrder` | `POST /orders/{orderId}/approve` | R-REV-01、R-REV-04、R-REV-05 | S-ORD-T02 |
| `rejectOrder` | `POST /orders/{orderId}/reject` | R-REV-02、R-REV-03 | S-ORD-T03、S-ORD-T04 |
| `reviseOrder` | `POST /orders/{orderId}/versions` | R-VER-01、R-VER-02、R-VER-04、R-VER-07、R-VER-08、R-VER-09、R-VER-10、CFG-REV-01 | S-ORD-T06 |
| `withdrawRevision` | `POST /orders/{orderId}/versions/withdraw` | R-VER-05 | S-ORD-T05 |
| `restoreVersion` | `POST /orders/{orderId}/versions/{n}/restore` | R-VER-06、R-VER-07、R-VER-09 | S-ORD-T07 |
| `cancelOrder` | `POST /orders/{orderId}/cancel` | R-CAN-01、R-CAN-02、R-CAN-03、R-CAN-04、R-CAN-05 | S-ORD-T18 |
| `reprintOrder` | `POST /orders/{orderId}/reprint` | R-PRT-09、R-PRT-10、R-PRT-18、R-VER-11、R-ARC-02 | S-ORD-T15 |
| `declineReprint` | `POST /orders/{orderId}/decline-reprint` | R-PRT-18、F-PRT-07 |  |
| `revokeReprintDecline` | `DELETE /orders/{orderId}/decline-reprint` | R-PRT-19 |  |
| `reconcileOrder` | `POST /orders/{orderId}/reconcile` | R-PRT-08 | S-ORD-T13、S-ORD-T14、S-ORD-T09 |
| `skipParts` | `POST /orders/{orderId}/skip-parts` | F-SUB-07、R-SKP-01、R-SKP-02、R-SKP-03、R-SKP-06 |  |
| `storeOrder` | `POST /orders/{orderId}/store` | R-PCK-01、INV-12 | S-ORD-T16、S-PRN-T25 |
| `disposeOrder` | `POST /orders/{orderId}/dispose` | R-PCK-05 | S-ORD-T21 |
| `issuePickupCode` | `POST /orders/{orderId}/pickup-code` | R-PCK-04、API-RATE-05 |  |
| `listTimelapses` | `GET /orders/{orderId}/timelapses` | R-VIS-06 |  |
| `viewTimelapse` | `GET /orders/{orderId}/timelapses/{timelapseId}` | R-VIS-06、R-CAM-04 |  |
| `getQueue` | `GET /queue` | R-QUE-01、INV-10 |  |
| `reorderQueue` | `POST /queue/reorder` | R-QUE-02 |  |
| `getDispatchSuggestions` | `GET /queue/suggestions` | R-DSP-01 |  |
| `getDispatchOptions` | `GET /printers/{printerId}/dispatch-options` | R-DSP-03、R-DSP-04、R-DSP-05、R-DSP-06、R-DSP-07、R-DSP-09、R-DSP-10、R-DSP-12、R-DSP-15 |  |
| `dispatchOrder` | `POST /printers/{printerId}/dispatch` | R-DSP-02、R-DSP-03、R-DSP-04、R-DSP-06、R-DSP-07、R-DSP-08、R-DSP-09、R-DSP-11、R-DSP-13、R-DSP-15、R-ARB-10 | S-ORD-T08、S-PRN-T20 |
| `listPrinters` | `GET /printers` |  |  |
| `createPrinter` | `POST /printers` | INV-08、INV-09、F-PRT-12 |  |
| `getPrinter` | `GET /printers/{printerId}` | R-VIS-04 |  |
| `updatePrinter` | `PATCH /printers/{printerId}` | INV-09、F-PRT-12、R-PRT-20 |  |
| `deletePrinter` | `DELETE /printers/{printerId}` |  |  |
| `setPrinterOpen` | `PUT /printers/{printerId}/open` |  |  |
| `setTrayGrams` | `PUT /printers/{printerId}/trays/{unit}/{slot}/grams` |  |  |
| `setPrinterStar` | `PUT /printers/{printerId}/star` |  |  |
| `enterMaintenance` | `POST /printers/{printerId}/maintenance/enter` |  | S-PRN-T22 |
| `exitMaintenance` | `POST /printers/{printerId}/maintenance/exit` |  | S-PRN-T23、S-PRN-T24 |
| `stopPrint` | `POST /printers/{printerId}/stop` | R-PRT-04、R-PRT-05、R-CMD-04、R-CMD-05、P-01 | S-ORD-T09、S-ORD-T13 |
| `resolveError` | `POST /printers/{printerId}/errors/{errorId}/resolve` | R-PRT-14 |  |
| `controlPrinter` | `POST /printers/{printerId}/control` | R-PRT-15、IF-ADP-05、INV-14、R-ARB-07、R-ARB-08、R-DSP-14 |  |
| `refreshPrinter` | `POST /printers/{printerId}/refresh` | R-PRT-12、API-RATE-03 |  |
| `getPrinterStorage` | `GET /printers/{printerId}/storage` | R-PRT-22、F-PRT-11 |  |
| `releasePrinter` | `POST /printers/{printerId}/release` | R-PRT-27、R-PRT-08 | S-PRN-T24、S-ORD-T13、S-ORD-T14、S-ORD-T09 |
| `listPrinterEvents` | `GET /printers/{printerId}/events` | R-PRT-26 |  |
| `confirmBedCleared` | `POST /printers/{printerId}/clear-bed` | R-PCK-02、INV-01 | S-PRN-T25 |
| `listPrinterErrors` | `GET /printers/{printerId}/errors` |  |  |
| `putPrinterPresence` | `PUT /printers/{printerId}/presence` | R-VIS-10、R-CMD-10、API-RT-07 |  |
| `deletePrinterPresence` | `DELETE /printers/{printerId}/presence` | R-VIS-10、API-RT-07 |  |
| `listPrinterJobs` | `GET /printers/{printerId}/jobs` | R-VIS-04、R-CAM-11 |  |
| `openCameraSession` | `POST /printers/{printerId}/camera/session` | R-CAM-01、R-CAM-02、R-CAM-06、R-CAM-07、API-CAM-01、API-CAM-02 |  |
| `cameraSnapshot` | `GET /printers/{printerId}/camera/snapshot` | R-CAM-02、R-CAM-03、API-CAM-03 |  |
| `listRedemptions` | `GET /pickup/redemptions` |  |  |
| `lookupPickup` | `GET /pickup/{code}` | R-PCK-03 |  |
| `redeemPickup` | `POST /pickup/{code}/redeem` | R-PCK-03、INV-05 | S-ORD-T17 |
| `getOverview` | `GET /overview` | F-UI-01、R-VIS-02、R-VIS-03、R-VIS-04 |  |
| `getResources` | `GET /resources` | R-SUB-11、R-QUE-04、CFG-SUB-04、CFG-SUB-05 |  |
| `getTodo` | `GET /todo` |  |  |
| `getCatalog` | `GET /catalog` |  |  |
| `createStockRow` | `POST /catalog` | R-SUB-12 |  |
| `updateCatalogRow` | `PATCH /catalog/{rowId}` |  |  |
| `deleteCatalogRow` | `DELETE /catalog/{rowId}` |  |  |
| `setAutoRow` | `PUT /catalog/auto/{autoKey}` |  |  |
| `setModelBedTypes` | `PUT /catalog/models/{modelId}/bed-types` | R-SUB-11 |  |
| `listUsers` | `GET /users` |  |  |
| `updateUser` | `PATCH /users/{userId}` | INV-13、API-AUTH-04、R-ACC-05 |  |
| `listInvites` | `GET /invites` |  |  |
| `createInvite` | `POST /invites` |  |  |
| `revokeInvite` | `DELETE /invites/{inviteId}` |  |  |
| `listDaemons` | `GET /daemons` |  |  |
| `createEnrollment` | `POST /daemons/enrollments` | F-DMN-01 |  |
| `updateDaemon` | `PATCH /daemons/{daemonId}` |  |  |
| `revokeDaemon` | `POST /daemons/{daemonId}/revoke` |  |  |
| `getDaemonPublicKey` | `GET /daemons/{daemonId}/public-key` |  |  |
| `listDiscovered` | `GET /daemons/{daemonId}/discovered` | F-PRT-12 |  |
| `getForm` | `GET /form` |  |  |
| `saveForm` | `PUT /form` |  |  |
| `getPublicSettings` | `GET /settings/public` |  |  |
| `getSettings` | `GET /settings` |  |  |
| `saveSettingsSection` | `PUT /settings/{section}` | F-OPS-06、P-04 |  |
| `listAudit` | `GET /audit` |  |  |
| `archivePeriod` | `POST /archive` | R-ARC-01、R-ARC-02、R-ARB-01、R-ARB-02 | S-ORD-T21、S-ORD-T22 |
| `listNotifications` | `GET /notifications` |  |  |
| `markNotificationsRead` | `POST /notifications/read` |  |  |
| `stream` | `GET /stream` | API-RT-01、API-RT-04、API-RT-06 |  |
