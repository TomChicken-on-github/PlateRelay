// 自动生成，不要手改。来源在 packages/shared/schema/，用 `pnpm --filter @platerelay/shared generate` 重新生成。

/** 每个接口的方法、路径和需要的权限（满足任意一个即可）。 */
export const operations = {
  "getAuthMethods": {
    "method": "GET",
    "path": "/auth/methods",
    "tag": "auth",
    "permissions": [
      "public"
    ],
    "hasJsonBody": false
  },
  "setup": {
    "method": "POST",
    "path": "/setup",
    "tag": "auth",
    "permissions": [
      "public"
    ],
    "hasJsonBody": true
  },
  "login": {
    "method": "POST",
    "path": "/auth/login",
    "tag": "auth",
    "permissions": [
      "public"
    ],
    "hasJsonBody": true
  },
  "logout": {
    "method": "POST",
    "path": "/auth/logout",
    "tag": "auth",
    "permissions": [
      "authenticated"
    ],
    "hasJsonBody": false
  },
  "issueCaptcha": {
    "method": "POST",
    "path": "/auth/captcha",
    "tag": "auth",
    "permissions": [
      "public"
    ],
    "hasJsonBody": true
  },
  "sendOtp": {
    "method": "POST",
    "path": "/auth/otp",
    "tag": "auth",
    "permissions": [
      "public"
    ],
    "hasJsonBody": true
  },
  "register": {
    "method": "POST",
    "path": "/auth/register",
    "tag": "auth",
    "permissions": [
      "public"
    ],
    "hasJsonBody": true
  },
  "oidcStart": {
    "method": "GET",
    "path": "/auth/oidc/{provider}/start",
    "tag": "auth",
    "permissions": [
      "public"
    ],
    "hasJsonBody": false
  },
  "oidcCallback": {
    "method": "GET",
    "path": "/auth/oidc/{provider}/callback",
    "tag": "auth",
    "permissions": [
      "public"
    ],
    "hasJsonBody": false
  },
  "getMe": {
    "method": "GET",
    "path": "/me",
    "tag": "me",
    "permissions": [
      "authenticated"
    ],
    "hasJsonBody": false
  },
  "updateMe": {
    "method": "PATCH",
    "path": "/me",
    "tag": "me",
    "permissions": [
      "authenticated"
    ],
    "hasJsonBody": true
  },
  "changePassword": {
    "method": "PUT",
    "path": "/me/password",
    "tag": "me",
    "permissions": [
      "authenticated"
    ],
    "hasJsonBody": true
  },
  "setAvatar": {
    "method": "PUT",
    "path": "/me/avatar",
    "tag": "me",
    "permissions": [
      "authenticated"
    ],
    "hasJsonBody": false
  },
  "getNotificationPrefs": {
    "method": "GET",
    "path": "/me/notification-prefs",
    "tag": "me",
    "permissions": [
      "authenticated"
    ],
    "hasJsonBody": false
  },
  "setNotificationPrefs": {
    "method": "PUT",
    "path": "/me/notification-prefs",
    "tag": "me",
    "permissions": [
      "authenticated"
    ],
    "hasJsonBody": true
  },
  "uploadFile": {
    "method": "POST",
    "path": "/files",
    "tag": "files",
    "permissions": [
      "order:submit"
    ],
    "hasJsonBody": false
  },
  "getFileCheck": {
    "method": "GET",
    "path": "/files/{fileId}/check",
    "tag": "files",
    "permissions": [
      "order:submit"
    ],
    "hasJsonBody": false
  },
  "listOrders": {
    "method": "GET",
    "path": "/orders",
    "tag": "orders",
    "permissions": [
      "order:view:any"
    ],
    "hasJsonBody": false
  },
  "submitOrders": {
    "method": "POST",
    "path": "/orders",
    "tag": "orders",
    "permissions": [
      "order:submit"
    ],
    "hasJsonBody": true
  },
  "listMyOrders": {
    "method": "GET",
    "path": "/orders/mine",
    "tag": "orders",
    "permissions": [
      "order:submit"
    ],
    "hasJsonBody": false
  },
  "getOrder": {
    "method": "GET",
    "path": "/orders/{orderId}",
    "tag": "orders",
    "permissions": [
      "order:submit",
      "order:view:any"
    ],
    "hasJsonBody": false
  },
  "listOrderRecords": {
    "method": "GET",
    "path": "/orders/{orderId}/records",
    "tag": "orders",
    "permissions": [
      "order:submit",
      "order:view:any"
    ],
    "hasJsonBody": false
  },
  "addDeviceStopNote": {
    "method": "POST",
    "path": "/orders/{orderId}/records",
    "tag": "orders",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": true
  },
  "downloadVersionFile": {
    "method": "GET",
    "path": "/orders/{orderId}/versions/{n}/file",
    "tag": "orders",
    "permissions": [
      "order:submit",
      "order:view:any"
    ],
    "hasJsonBody": false
  },
  "getOrderParts": {
    "method": "GET",
    "path": "/orders/{orderId}/parts",
    "tag": "orders",
    "permissions": [
      "order:skip-parts:own",
      "order:skip-parts:any"
    ],
    "hasJsonBody": false
  },
  "approveOrder": {
    "method": "POST",
    "path": "/orders/{orderId}/approve",
    "tag": "orders",
    "permissions": [
      "order:review"
    ],
    "hasJsonBody": true
  },
  "rejectOrder": {
    "method": "POST",
    "path": "/orders/{orderId}/reject",
    "tag": "orders",
    "permissions": [
      "order:review"
    ],
    "hasJsonBody": true
  },
  "reviseOrder": {
    "method": "POST",
    "path": "/orders/{orderId}/versions",
    "tag": "orders",
    "permissions": [
      "order:submit"
    ],
    "hasJsonBody": true
  },
  "withdrawRevision": {
    "method": "POST",
    "path": "/orders/{orderId}/versions/withdraw",
    "tag": "orders",
    "permissions": [
      "order:submit"
    ],
    "hasJsonBody": true
  },
  "restoreVersion": {
    "method": "POST",
    "path": "/orders/{orderId}/versions/{n}/restore",
    "tag": "orders",
    "permissions": [
      "order:submit"
    ],
    "hasJsonBody": true
  },
  "cancelOrder": {
    "method": "POST",
    "path": "/orders/{orderId}/cancel",
    "tag": "orders",
    "permissions": [
      "order:cancel:own",
      "order:cancel:any"
    ],
    "hasJsonBody": true
  },
  "reprintOrder": {
    "method": "POST",
    "path": "/orders/{orderId}/reprint",
    "tag": "orders",
    "permissions": [
      "order:reprint"
    ],
    "hasJsonBody": true
  },
  "declineReprint": {
    "method": "POST",
    "path": "/orders/{orderId}/decline-reprint",
    "tag": "orders",
    "permissions": [
      "order:reprint"
    ],
    "hasJsonBody": true
  },
  "revokeReprintDecline": {
    "method": "DELETE",
    "path": "/orders/{orderId}/decline-reprint",
    "tag": "orders",
    "permissions": [
      "order:reprint:restore"
    ],
    "hasJsonBody": false
  },
  "reconcileOrder": {
    "method": "POST",
    "path": "/orders/{orderId}/reconcile",
    "tag": "orders",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": true
  },
  "skipParts": {
    "method": "POST",
    "path": "/orders/{orderId}/skip-parts",
    "tag": "orders",
    "permissions": [
      "order:skip-parts:own",
      "order:skip-parts:any"
    ],
    "hasJsonBody": true
  },
  "storeOrder": {
    "method": "POST",
    "path": "/orders/{orderId}/store",
    "tag": "orders",
    "permissions": [
      "order:store"
    ],
    "hasJsonBody": false
  },
  "disposeOrder": {
    "method": "POST",
    "path": "/orders/{orderId}/dispose",
    "tag": "orders",
    "permissions": [
      "order:dispose"
    ],
    "hasJsonBody": true
  },
  "issuePickupCode": {
    "method": "POST",
    "path": "/orders/{orderId}/pickup-code",
    "tag": "pickup",
    "permissions": [
      "order:submit"
    ],
    "hasJsonBody": true
  },
  "listTimelapses": {
    "method": "GET",
    "path": "/orders/{orderId}/timelapses",
    "tag": "orders",
    "permissions": [
      "order:submit",
      "order:view:any"
    ],
    "hasJsonBody": false
  },
  "viewTimelapse": {
    "method": "GET",
    "path": "/orders/{orderId}/timelapses/{timelapseId}",
    "tag": "orders",
    "permissions": [
      "order:submit",
      "order:view:any"
    ],
    "hasJsonBody": false
  },
  "getQueue": {
    "method": "GET",
    "path": "/queue",
    "tag": "queue",
    "permissions": [
      "order:view:any"
    ],
    "hasJsonBody": false
  },
  "reorderQueue": {
    "method": "POST",
    "path": "/queue/reorder",
    "tag": "queue",
    "permissions": [
      "order:reorder"
    ],
    "hasJsonBody": true
  },
  "getDispatchSuggestions": {
    "method": "GET",
    "path": "/queue/suggestions",
    "tag": "queue",
    "permissions": [
      "order:dispatch"
    ],
    "hasJsonBody": false
  },
  "getDispatchOptions": {
    "method": "GET",
    "path": "/printers/{printerId}/dispatch-options",
    "tag": "queue",
    "permissions": [
      "order:dispatch"
    ],
    "hasJsonBody": false
  },
  "dispatchOrder": {
    "method": "POST",
    "path": "/printers/{printerId}/dispatch",
    "tag": "queue",
    "permissions": [
      "order:dispatch"
    ],
    "hasJsonBody": true
  },
  "listPrinters": {
    "method": "GET",
    "path": "/printers",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": false
  },
  "createPrinter": {
    "method": "POST",
    "path": "/printers",
    "tag": "printers",
    "permissions": [
      "printer:manage"
    ],
    "hasJsonBody": true
  },
  "getPrinter": {
    "method": "GET",
    "path": "/printers/{printerId}",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": false
  },
  "updatePrinter": {
    "method": "PATCH",
    "path": "/printers/{printerId}",
    "tag": "printers",
    "permissions": [
      "printer:manage"
    ],
    "hasJsonBody": true
  },
  "deletePrinter": {
    "method": "DELETE",
    "path": "/printers/{printerId}",
    "tag": "printers",
    "permissions": [
      "printer:manage"
    ],
    "hasJsonBody": true
  },
  "setPrinterOpen": {
    "method": "PUT",
    "path": "/printers/{printerId}/open",
    "tag": "printers",
    "permissions": [
      "resource:configure"
    ],
    "hasJsonBody": true
  },
  "setTrayGrams": {
    "method": "PUT",
    "path": "/printers/{printerId}/trays/{unit}/{slot}/grams",
    "tag": "printers",
    "permissions": [
      "filament:catalog"
    ],
    "hasJsonBody": true
  },
  "setPrinterStar": {
    "method": "PUT",
    "path": "/printers/{printerId}/star",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": true
  },
  "enterMaintenance": {
    "method": "POST",
    "path": "/printers/{printerId}/maintenance/enter",
    "tag": "printers",
    "permissions": [
      "printer:maintenance"
    ],
    "hasJsonBody": true
  },
  "exitMaintenance": {
    "method": "POST",
    "path": "/printers/{printerId}/maintenance/exit",
    "tag": "printers",
    "permissions": [
      "printer:maintenance"
    ],
    "hasJsonBody": true
  },
  "stopPrint": {
    "method": "POST",
    "path": "/printers/{printerId}/stop",
    "tag": "printers",
    "permissions": [
      "printer:stop"
    ],
    "hasJsonBody": true
  },
  "resolveError": {
    "method": "POST",
    "path": "/printers/{printerId}/errors/{errorId}/resolve",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": true
  },
  "controlPrinter": {
    "method": "POST",
    "path": "/printers/{printerId}/control",
    "tag": "printers",
    "permissions": [
      "printer:control"
    ],
    "hasJsonBody": true
  },
  "refreshPrinter": {
    "method": "POST",
    "path": "/printers/{printerId}/refresh",
    "tag": "printers",
    "permissions": [
      "printer:refresh"
    ],
    "hasJsonBody": true
  },
  "getPrinterStorage": {
    "method": "GET",
    "path": "/printers/{printerId}/storage",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": false
  },
  "releasePrinter": {
    "method": "POST",
    "path": "/printers/{printerId}/release",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": true
  },
  "listPrinterEvents": {
    "method": "GET",
    "path": "/printers/{printerId}/events",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": false
  },
  "confirmBedCleared": {
    "method": "POST",
    "path": "/printers/{printerId}/clear-bed",
    "tag": "printers",
    "permissions": [
      "order:store"
    ],
    "hasJsonBody": true
  },
  "listPrinterErrors": {
    "method": "GET",
    "path": "/printers/{printerId}/errors",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": false
  },
  "putPrinterPresence": {
    "method": "PUT",
    "path": "/printers/{printerId}/presence",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": true
  },
  "deletePrinterPresence": {
    "method": "DELETE",
    "path": "/printers/{printerId}/presence",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": false
  },
  "listPrinterJobs": {
    "method": "GET",
    "path": "/printers/{printerId}/jobs",
    "tag": "printers",
    "permissions": [
      "printer:operate"
    ],
    "hasJsonBody": false
  },
  "openCameraSession": {
    "method": "POST",
    "path": "/printers/{printerId}/camera/session",
    "tag": "printers",
    "permissions": [
      "guest",
      "printer:camera:stream"
    ],
    "hasJsonBody": true
  },
  "cameraSnapshot": {
    "method": "GET",
    "path": "/printers/{printerId}/camera/snapshot",
    "tag": "printers",
    "permissions": [
      "guest",
      "printer:camera:snapshot"
    ],
    "hasJsonBody": false
  },
  "listRedemptions": {
    "method": "GET",
    "path": "/pickup/redemptions",
    "tag": "pickup",
    "permissions": [
      "order:redeem"
    ],
    "hasJsonBody": false
  },
  "lookupPickup": {
    "method": "GET",
    "path": "/pickup/{code}",
    "tag": "pickup",
    "permissions": [
      "order:redeem"
    ],
    "hasJsonBody": false
  },
  "redeemPickup": {
    "method": "POST",
    "path": "/pickup/{code}/redeem",
    "tag": "pickup",
    "permissions": [
      "order:redeem"
    ],
    "hasJsonBody": true
  },
  "getOverview": {
    "method": "GET",
    "path": "/overview",
    "tag": "overview",
    "permissions": [
      "guest",
      "overview:view"
    ],
    "hasJsonBody": false
  },
  "getResources": {
    "method": "GET",
    "path": "/resources",
    "tag": "overview",
    "permissions": [
      "resource:view"
    ],
    "hasJsonBody": false
  },
  "getTodo": {
    "method": "GET",
    "path": "/todo",
    "tag": "overview",
    "permissions": [
      "order:review",
      "printer:operate"
    ],
    "hasJsonBody": false
  },
  "getCatalog": {
    "method": "GET",
    "path": "/catalog",
    "tag": "catalog",
    "permissions": [
      "filament:catalog"
    ],
    "hasJsonBody": false
  },
  "createStockRow": {
    "method": "POST",
    "path": "/catalog",
    "tag": "catalog",
    "permissions": [
      "filament:catalog"
    ],
    "hasJsonBody": true
  },
  "updateCatalogRow": {
    "method": "PATCH",
    "path": "/catalog/{rowId}",
    "tag": "catalog",
    "permissions": [
      "filament:catalog"
    ],
    "hasJsonBody": true
  },
  "deleteCatalogRow": {
    "method": "DELETE",
    "path": "/catalog/{rowId}",
    "tag": "catalog",
    "permissions": [
      "filament:catalog"
    ],
    "hasJsonBody": true
  },
  "setAutoRow": {
    "method": "PUT",
    "path": "/catalog/auto/{autoKey}",
    "tag": "catalog",
    "permissions": [
      "filament:catalog"
    ],
    "hasJsonBody": true
  },
  "setModelBedTypes": {
    "method": "PUT",
    "path": "/catalog/models/{modelId}/bed-types",
    "tag": "catalog",
    "permissions": [
      "filament:catalog"
    ],
    "hasJsonBody": true
  },
  "listUsers": {
    "method": "GET",
    "path": "/users",
    "tag": "admin",
    "permissions": [
      "user:manage"
    ],
    "hasJsonBody": false
  },
  "updateUser": {
    "method": "PATCH",
    "path": "/users/{userId}",
    "tag": "admin",
    "permissions": [
      "user:manage"
    ],
    "hasJsonBody": true
  },
  "listInvites": {
    "method": "GET",
    "path": "/invites",
    "tag": "admin",
    "permissions": [
      "user:manage"
    ],
    "hasJsonBody": false
  },
  "createInvite": {
    "method": "POST",
    "path": "/invites",
    "tag": "admin",
    "permissions": [
      "user:manage"
    ],
    "hasJsonBody": true
  },
  "revokeInvite": {
    "method": "DELETE",
    "path": "/invites/{inviteId}",
    "tag": "admin",
    "permissions": [
      "user:manage"
    ],
    "hasJsonBody": false
  },
  "listDaemons": {
    "method": "GET",
    "path": "/daemons",
    "tag": "admin",
    "permissions": [
      "daemon:manage"
    ],
    "hasJsonBody": false
  },
  "createEnrollment": {
    "method": "POST",
    "path": "/daemons/enrollments",
    "tag": "admin",
    "permissions": [
      "daemon:manage"
    ],
    "hasJsonBody": true
  },
  "updateDaemon": {
    "method": "PATCH",
    "path": "/daemons/{daemonId}",
    "tag": "admin",
    "permissions": [
      "daemon:manage"
    ],
    "hasJsonBody": true
  },
  "revokeDaemon": {
    "method": "POST",
    "path": "/daemons/{daemonId}/revoke",
    "tag": "admin",
    "permissions": [
      "daemon:manage"
    ],
    "hasJsonBody": true
  },
  "getDaemonPublicKey": {
    "method": "GET",
    "path": "/daemons/{daemonId}/public-key",
    "tag": "admin",
    "permissions": [
      "printer:manage"
    ],
    "hasJsonBody": false
  },
  "listDiscovered": {
    "method": "GET",
    "path": "/daemons/{daemonId}/discovered",
    "tag": "admin",
    "permissions": [
      "printer:manage"
    ],
    "hasJsonBody": false
  },
  "getForm": {
    "method": "GET",
    "path": "/form",
    "tag": "admin",
    "permissions": [
      "order:submit",
      "form:configure"
    ],
    "hasJsonBody": false
  },
  "saveForm": {
    "method": "PUT",
    "path": "/form",
    "tag": "admin",
    "permissions": [
      "form:configure"
    ],
    "hasJsonBody": true
  },
  "getPublicSettings": {
    "method": "GET",
    "path": "/settings/public",
    "tag": "admin",
    "permissions": [
      "public"
    ],
    "hasJsonBody": false
  },
  "getSettings": {
    "method": "GET",
    "path": "/settings",
    "tag": "admin",
    "permissions": [
      "settings:manage",
      "resource:configure"
    ],
    "hasJsonBody": false
  },
  "saveSettingsSection": {
    "method": "PUT",
    "path": "/settings/{section}",
    "tag": "admin",
    "permissions": [
      "settings:manage",
      "resource:configure"
    ],
    "hasJsonBody": true
  },
  "listAudit": {
    "method": "GET",
    "path": "/audit",
    "tag": "admin",
    "permissions": [
      "audit:view"
    ],
    "hasJsonBody": false
  },
  "archivePeriod": {
    "method": "POST",
    "path": "/archive",
    "tag": "admin",
    "permissions": [
      "settings:manage"
    ],
    "hasJsonBody": true
  },
  "listNotifications": {
    "method": "GET",
    "path": "/notifications",
    "tag": "notifications",
    "permissions": [
      "authenticated"
    ],
    "hasJsonBody": false
  },
  "markNotificationsRead": {
    "method": "POST",
    "path": "/notifications/read",
    "tag": "notifications",
    "permissions": [
      "authenticated"
    ],
    "hasJsonBody": true
  },
  "stream": {
    "method": "GET",
    "path": "/stream",
    "tag": "stream",
    "permissions": [
      "guest",
      "authenticated"
    ],
    "hasJsonBody": false
  }
} as const;

export type OperationId = keyof typeof operations;
