// 自动生成，不要手改。来源在 packages/shared/schema/，用 `pnpm --filter @platerelay/shared generate` 重新生成。

export interface paths {
    "/auth/methods": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 可用的注册和登录方式 */
        get: operations["getAuthMethods"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/setup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 初始化向导：创建第一个管理员
         * @description 只在系统里还没有用户时可用，之后返回 404。
         */
        post: operations["setup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 用户名密码登录
         * @description 成功时设置会话 Cookie。
         */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 退出登录 */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/captcha": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 领一个人机验证挑战 */
        post: operations["issueCaptcha"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/otp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 发送短信或邮件验证码
         * @description 短信一律要 captcha；邮件按「发邮件验证码前的人机验证」设置，需要而没带时返回 422 captcha_required。
         */
        post: operations["sendOtp"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 注册 */
        post: operations["register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/oidc/{provider}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 跳转到外部登录 */
        get: operations["oidcStart"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/auth/oidc/{provider}/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 外部登录回调 */
        get: operations["oidcCallback"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 当前用户和权限 */
        get: operations["getMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 改显示名、界面语言 */
        patch: operations["updateMe"];
        trace?: never;
    };
    "/me/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 改密码 */
        put: operations["changePassword"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 换头像 */
        put: operations["setAvatar"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/me/notification-prefs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 个人通知设置 */
        get: operations["getNotificationPrefs"];
        /** 保存个人通知设置 */
        put: operations["setNotificationPrefs"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/files": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 上传 .gcode.3mf
         * @description 返回时校验通常还没完成，等 file.checked 推送或轮询。这个人手上没提交的文件达到设置的个数（默认从第 3 个起；校验被拒的和已提交的不算）时要带 captcha（先调 issueCaptcha），没带返回 422 captcha_required，和登录一样。没提交的文件过了设置的保留时间（默认 2 小时）自动删除，没有删除接口。
         */
        post: operations["uploadFile"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/files/{fileId}/check": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 解析和校验结果
         * @description 只能查自己上传的。
         */
        get: operations["getFileCheck"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 全部订单（订单管理）
         * @description 按提交时间倒序。
         */
        get: operations["listOrders"];
        put?: never;
        /**
         * 提交：每盘一个订单
         * @description 多盘一次提交，超过排队上限整次拒绝。表单版本不是最新时返回 409 version_conflict。
         */
        post: operations["submitOrders"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/mine": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 我的订单
         * @description 按提交时间倒序。
         */
        get: operations["listMyOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 订单详情
         * @description 本人或 order:view:any；看不到返回 404。
         */
        get: operations["getOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/records": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 订单时间线记录
         * @description 按时间正序。申请者只收到选手可见的备注。
         */
        get: operations["listOrderRecords"];
        put?: never;
        /**
         * 给"在设备端停止"补一条备注
         * @description 只能指向 kind=print.stopped_on_device 的记录。记录只追加，所以备注是一条新记录 note.added，data.refRecordId 指向原记录，归在"打印"节点下。
         */
        post: operations["addDeviceStopNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/versions/{n}/file": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 下载某个版本的文件 */
        get: operations["downloadVersionFile"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/parts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 零件列表和图（跳过零件用） */
        get: operations["getOrderParts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 审核通过
         * @description versionId 是审核人看到的那个待审版本，防止审了一个版本却通过了另一个。
         */
        post: operations["approveOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 驳回（新提交或修改） */
        post: operations["rejectOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 修改文件（上传新版本）
         * @description 只限本人。第一次审核前是替换；已派单返回 422 order_dispatched，开始打印及之后返回 422 order_started；次数用完返回 422 revision_limit_reached。
         */
        post: operations["reviseOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/versions/withdraw": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 撤回修改
         * @description 只限本人。
         */
        post: operations["withdrawRevision"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/versions/{n}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 恢复旧版本
         * @description 只限本人。
         */
        post: operations["restoreVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 取消订单
         * @description 只有待审核、排队中能取消。已派单返回 422 order_dispatched（请现场人员先停止）；打印中、失败、打完的单返回 422 order_started。
         */
        post: operations["cancelOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/reprint": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 重打
         * @description 文件过期返回 410 file_expired；归档过或被标为不重打的失败订单返回 422 reprint_not_allowed，params.reason 为 ARCHIVED / DECLINED（不看申请者账户是否停用）。
         */
        post: operations["reprintOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/decline-reprint": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 不重打，请选手重新提交
         * @description 只用于选手模型本身的问题。订单仍是失败，记下不重打，重打按钮隐藏，移出现场人员待办，通知申请者并带原因。时间线记 reprint.declined，挂在打印节点下，原因默认选手可见。归档过或已经标过返回 409 state_conflict。
         */
        post: operations["declineReprint"];
        /**
         * 撤销不重打
         * @description 只有管理员。清掉不重打标记，重打按钮恢复，订单回现场人员待办；时间线记 reprint.decline_revoked，记审计。没标过或归档过返回 409 state_conflict。
         */
        delete: operations["revokeReprintDecline"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/reconcile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 人工判定：判失败、判打完或判没开打
         * @description 只在这个任务的打印机挂着 JUDGE 原因时可用（对账分不清任务结局，或开打指令可能没到），否则 409 state_conflict；放出异常打印机时的判定走 releasePrinter。打印机上报这个任务正在运行时不能判，返回 409 state_conflict。判没开打（NOT_STARTED）：任务以 STOPPED_BEFORE_START 结束，订单回排队原位，打印机进待清板，面板给 daemon 发 job.stop 让它记下不再开打。
         */
        post: operations["reconcileOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/skip-parts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 跳过零件
         * @description 只在任务打印中或暂停中可用（准备中 409 state_conflict）；跳完至少剩一个没跳的零件，否则 422 skip_all_parts（全跳等于停止，申请者不能停止打印）。不能撤回，前端先二次确认。是控制命令，没有命令锁。已跳过列表以打印机上报为准写进打印任务的 skipped_parts；时间线打印节点记 parts.skipped，默认选手可见，现场人员只显示角色。
         */
        post: operations["skipParts"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/store": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 铲件入库
         * @description 只要求订单是待入库。打印机在待清板时同一个事务里放行到可用；不在待清板时只入库订单，打印机状态不动。
         */
        post: operations["storeOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/dispose": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 标为已处置
         * @description 长期没取走的待取件订单由管理员标为已处置，必须填原因。
         */
        post: operations["disposeOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/pickup-code": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 签发取件码
         * @description 只限本人。新码作废旧码。
         */
        post: operations["issuePickupCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/timelapses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 延时摄影列表
         * @description 本人、现场人员、管理员。
         */
        get: operations["listTimelapses"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/orders/{orderId}/timelapses/{timelapseId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 看延时摄影 */
        get: operations["viewTimelapse"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/queue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 完整队列（含冻结的）
         * @description 按排序值升序，不分页。申请者看自己的排位用 /orders/mine。
         */
        get: operations["getQueue"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/queue/reorder": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 拖拽调整顺序
         * @description afterOrderId 为 null 表示放到队首。不填备注，只记审计。
         */
        post: operations["reorderQueue"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/queue/suggestions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 派单建议 */
        get: operations["getDispatchSuggestions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/dispatch-options": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 某单派到某台的可行性和映射建议
         * @description 打印机不是可用或已停用时返回 409 printer_not_available，params.state 和 params.reasons 列出原因。
         */
        get: operations["getDispatchOptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/dispatch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 派单
         * @description 服务端按提交的映射重新校验；有 BLOCK 项返回 422，有 WARN 项但没填原因也返回 422。打印机不是可用或已停用返回 409 printer_not_available（params.state、params.reasons），手动派单也一样。
         */
        post: operations["dispatchOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 打印机列表（带详情） */
        get: operations["listPrinters"];
        put?: never;
        /**
         * 添加打印机
         * @description 新加的默认不开放给选手。
         */
        post: operations["createPrinter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 打印机详情 */
        get: operations["getPrinter"];
        put?: never;
        post?: never;
        /**
         * 删除打印机
         * @description 只能删从没派过单的；派过单的返回 422。
         */
        delete: operations["deletePrinter"];
        options?: never;
        head?: never;
        /**
         * 编辑打印机
         * @description 改 daemonId = 显式把打印机移到另一个 daemon（一台打印机同一时间只归一个 daemon），必须同时重填访问码；新 daemon 按下发的 currentJobRef 认领还在打的系统任务。disabled=true 停用、false 重新启用：只在可用或异常且没有当前任务时能停用，否则 409 state_conflict；停用时挂 OFFLINE，重新启用后按对账走，必经待清板；停用后概况页和派单都不显示，记录保留。
         */
        patch: operations["updatePrinter"];
        trace?: never;
    };
    "/printers/{printerId}/open": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 开放给选手 */
        put: operations["setPrinterOpen"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/trays/{unit}/{slot}/grams": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 改槽位剩余克数
         * @description 人改过即去掉"待确认"；记审计，不写回打印机。RFID 卷也可以改
         */
        put: operations["setTrayGrams"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/star": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 概况页置顶 */
        put: operations["setPrinterStar"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/maintenance/enter": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 挂上维护原因
         * @description 给打印机挂异常原因 MAINTENANCE，任何状态都能挂；有当前任务时任务照常推进。
         */
        post: operations["enterMaintenance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/maintenance/exit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 去掉维护原因
         * @description 去掉 MAINTENANCE 原因。没有别的原因时，打印机还在跑东西（如测试打印）进工作，否则进待清板，由人确认清板后才可用；不再需要勾"热床已清理"。
         */
        post: operations["exitMaintenance"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/stop": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 停止打印
         * @description 前端先让人选原因并二次确认。任务在传文件（daemon 中止传输并确认没开打）、准备中、打印中、暂停中都发 job.stop，没有命令锁；打印机还报打印中或暂停中时可以再点。打印机报告没开打就停下 → 订单回原位；开打后停下 → 失败。"开打可能没到"待办里的"停止并退回队列"也是调这个接口：订单只在打印机报已停止 / 已取消，或 daemon 确认没开打后才回原位；daemon 确认不了时打印机挂 JUDGE，由人判。
         */
        post: operations["stopPrint"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/errors/{errorId}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 处理报错
         * @description 同一条报错只接受第一个处理动作，后到的返回 409。requiresOnSite 的选项要 onSiteConfirmed=true。
         */
        post: operations["resolveError"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/control": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 设备控制 */
        post: operations["controlPrinter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 刷新机器状态（只读） */
        post: operations["refreshPrinter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/storage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 打印机存储（只读）
         * @description 面板向 daemon 发一次 storage.list，等结果（最多 10 秒）再返回。daemon 不在线或超时返回 503。只读，没有删除和下载。
         */
        get: operations["getPrinterStorage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/release": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 放出异常的打印机
         * @description 去掉这台打印机除 OFFLINE 以外的全部异常原因，没有别的原因就进待清板；还联系不上的留在异常，重连后再进待清板。打印机连着且最新上报正在运行时返回 409 state_conflict；挂着 OFFLINE 时不看旧上报。有当前任务时必须带 expectedJobId 和 outcome，没有时两者都不带，否则 422。判没开打时给 daemon 发 job.stop。写审计。
         */
        post: operations["releasePrinter"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 打印机事件日志
         * @description 最新的在前，游标分页。只读。
         */
        get: operations["listPrinterEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/clear-bed": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 确认清板
         * @description 这台打印机上还有待入库的订单时返回 422，要走铲件入库。
         */
        post: operations["confirmBedCleared"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/errors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 报错历史 */
        get: operations["listPrinterErrors"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/presence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 打印机详情页在场心跳
         * @description 详情页打开时每 20 秒调一次，45 秒没续上就算离开。只在内存里记，不进数据库。只是提示，不挡任何操作。
         */
        put: operations["putPrinterPresence"];
        post?: never;
        /** 离开打印机详情页 */
        delete: operations["deletePrinterPresence"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 打印机的打印记录
         * @description 打印机详情里的"打印记录"：这台打印机的打印任务，最新派的在前（按 dispatchedAt 倒序），游标翻页。任务不单独成页，也没有跨打印机的任务列表。每条点开进订单详情。申请者按通常的可见性规则返回。
         */
        get: operations["listPrinterJobs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/camera/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 申请看实况
         * @description 没登录的访客要「概况页公开」和「访客可看实况」两个设置都开，否则 401。拿不到返回 409 stream_unavailable，到上限返回 409 camera_limit，前端改看抓拍。
         */
        post: operations["openCameraSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/printers/{printerId}/camera/snapshot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 最新一张抓拍 */
        get: operations["cameraSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/pickup/redemptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 最近核销记录 */
        get: operations["listRedemptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/pickup/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 扫码查单
         * @description 码无效、过期、已作废都返回 404。
         */
        get: operations["lookupPickup"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/pickup/{code}/redeem": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 核销 */
        post: operations["redeemPickup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/overview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 概况页 */
        get: operations["getOverview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/resources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 提交页可用资源 */
        get: operations["getResources"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/todo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 待办
         * @description 按权限过滤：管理员看到待审核，现场人员看到打印机相关的。从状态实时算。
         */
        get: operations["getTodo"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 耗材目录（含隐藏的） */
        get: operations["getCatalog"];
        put?: never;
        /** 加库存行 */
        post: operations["createStockRow"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog/{rowId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** 删库存行 */
        delete: operations["deleteCatalogRow"];
        options?: never;
        head?: never;
        /** 改库存行或自动行设置 */
        patch: operations["updateCatalogRow"];
        trace?: never;
    };
    "/catalog/auto/{autoKey}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 设置某个自动行（隐藏、排序、备注）
         * @description 第一次设置时 version 传 null。
         */
        put: operations["setAutoRow"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog/models/{modelId}/bed-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** 设置某个机型本场能用的板型（整组替换） */
        put: operations["setModelBedTypes"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 用户列表 */
        get: operations["listUsers"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/users/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * 改角色、停用
         * @description disabled=true 时前端先在确认框列出他还没打完的订单。停用只管登录和提交，不连带取消订单，要取消的由管理员另外取消。
         */
        patch: operations["updateUser"];
        trace?: never;
    };
    "/invites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 邀请码 */
        get: operations["listInvites"];
        put?: never;
        /** 新建邀请码 */
        post: operations["createInvite"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/invites/{inviteId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** 作废邀请码 */
        delete: operations["revokeInvite"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/daemons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** daemon 列表 */
        get: operations["listDaemons"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/daemons/enrollments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 生成安装命令 */
        post: operations["createEnrollment"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/daemons/{daemonId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** 改名字 */
        patch: operations["updateDaemon"];
        trace?: never;
    };
    "/daemons/{daemonId}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * 吊销
         * @description 立刻断开它的连接；它名下的打印机异常(联系不上)，要管理员移到别的 daemon。
         */
        post: operations["revokeDaemon"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/daemons/{daemonId}/public-key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** daemon 公钥（浏览器加密访问码用） */
        get: operations["getDaemonPublicKey"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/daemons/{daemonId}/discovered": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 这个 daemon 听到的打印机 */
        get: operations["listDiscovered"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/form": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 当前申请表单 */
        get: operations["getForm"];
        /**
         * 保存申请表单（新版本）
         * @description basedOnVersionId 不是最新版本时返回 409 version_conflict。
         */
        put: operations["saveForm"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/public": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 界面需要的公开设置 */
        get: operations["getPublicSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 系统设置（全部分区）
         * @description 只有 resource:configure 的人只收到 mapping 分区。
         */
        get: operations["getSettings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/settings/{section}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * 按分区保存
         * @description mapping 分区要 resource:configure，其他要 settings:manage。范围和关联校验失败返回 422。
         */
        put: operations["saveSettingsSection"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * 审计日志
         * @description 按时间倒序。
         */
        get: operations["listAudit"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 归档本期 */
        post: operations["archivePeriod"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 我的通知 */
        get: operations["listNotifications"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/notifications/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** 标为已读 */
        post: operations["markNotificationsRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** 实时推送（SSE） */
        get: operations["stream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Problem: {
            /** Format: uri */
            type: string;
            title: string;
            status: number;
            /** @description 英文错误码，前端靠它查文案 */
            code: string;
            detail?: string;
            params?: {
                [key: string]: unknown;
            };
            requestId: string;
            errors?: {
                path: string;
                code: string;
                params?: {
                    [key: string]: unknown;
                };
            }[];
        };
        /** @description 命令已记下并发出。结果通过实时推送到达。 */
        CommandAccepted: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            printerId: string;
        };
        /** @description 显示名和头像（order:submitter-name:view-others）。系统动作时 id 为 null。 */
        Person: {
            /** Format: uuid */
            id: string | null;
            name: string;
            /** Format: uri */
            avatarUrl: string | null;
        };
        /** @enum {string} */
        Role: "APPLICANT" | "STAFF" | "ADMIN";
        /**
         * @description 订单状态。DISPATCHED = 订单有一个指定了打印机的当前任务，打印机还没报开始打印，传文件和准备中都算
         * @enum {string}
         */
        OrderStatus: "PENDING_REVIEW" | "REJECTED" | "QUEUED" | "DISPATCHED" | "PRINTING" | "FAILED" | "PRINTED" | "READY" | "COMPLETED" | "CANCELLED" | "DISPOSED";
        /**
         * @description 打印机的四个状态。准备中、打印中、暂停中看 job.phase
         * @enum {string}
         */
        PrinterState: "AVAILABLE" | "WORKING" | "ATTENTION" | "CLEARING_REQUIRED";
        /**
         * @description 打印机处于异常的原因，可以同时有多个
         * @enum {string}
         */
        AttentionReason: "OFFLINE" | "ERROR" | "MAINTENANCE" | "JUDGE" | "SEND_FAILED" | "DAEMON_UPGRADE";
        /** @enum {string} */
        PauseReason: "USER" | "ERROR" | "RUNOUT";
        /** @enum {string} */
        ColourPref: "EXACT" | "SIMILAR" | "ANY";
        /** @enum {string} */
        ProcessNode: "SUBMIT" | "REVIEW" | "QUEUE" | "PRINT" | "STORE" | "PICKUP";
        /** @enum {string} */
        NodeState: "NOT_REACHED" | "ACTIVE" | "DONE" | "PROBLEM";
        /** @enum {string} */
        VersionKind: "SUBMIT" | "REPLACE" | "REVISION" | "RESTORE";
        /** @enum {string} */
        VersionState: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "REPLACED";
        /** @description 权限节点，如 order:view:any */
        Permission: string;
        Nozzle: {
            extruder: number;
            /** @enum {string|null} */
            side: "LEFT" | "RIGHT" | null;
            diameterMm: number;
            /** @enum {string|null} */
            flow: "STANDARD" | "HIGH" | null;
        };
        SliceFilament: {
            slot: number;
            extruder: number | null;
            material: string;
            subType: string | null;
            colour: string;
            usedGrams: number;
        };
        Part: {
            id: number;
            name: string;
        };
        Plate: {
            index: number;
            name: string;
            modelId: string;
            modelName: string | null;
            nozzles: components["schemas"]["Nozzle"][];
            filaments: components["schemas"]["SliceFilament"][];
            printSeconds: number;
            weightGrams: number;
            /** Format: uri */
            thumbnailUrl: string | null;
            parts: components["schemas"]["Part"][];
            /** @description 机型、喷嘴能对上开放的打印机 */
            submittable: boolean;
            /** @description 提交页提示：耗材不在目录、颜色缺失、双喷头只用一个…… */
            hints: {
                code: string;
                params: {
                    [key: string]: unknown;
                };
            }[];
        };
        Finding: {
            /** @enum {string} */
            check: "structure" | "consistency" | "bounds" | "dangerous";
            code: string;
            /** @enum {string} */
            severity: "REJECT" | "WARN";
            plate: number | null;
            detail: {
                [key: string]: unknown;
            };
        };
        FileCheck: {
            /** Format: uuid */
            fileId: string;
            fileName: string;
            sizeBytes: number;
            /** @enum {string} */
            status: "QUEUED" | "RUNNING" | "DONE" | "ERROR";
            /** @enum {string|null} */
            verdict: "PASS" | "WARN" | "REJECT" | null;
            plates: components["schemas"]["Plate"][];
            /** @description 申请者只看到拒收项；警告项只给审核人 */
            findings: components["schemas"]["Finding"][];
        };
        Answer: {
            fieldId: string;
            label: string;
            type: components["schemas"]["FormFieldType"];
            value: string | string[] | number | null;
        };
        OrderVersion: {
            /** Format: uuid */
            id: string;
            n: number;
            kind: components["schemas"]["VersionKind"];
            state: components["schemas"]["VersionState"];
            restoredFromN?: number | null;
            plate: components["schemas"]["Plate"];
            fileName?: string;
            deltaSeconds?: number | null;
            /** @description -1 = 队尾 */
            placesBack?: number | null;
            counted: boolean;
            modelSwitch: boolean;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            decidedAt?: string | null;
            reason?: string | null;
            /** @description 文件没过保留期 */
            fileAvailable: boolean;
        };
        /** @description OrderSummary 和 OrderDetail 共用的字段，本身不封闭；封闭在组合外层用 unevaluatedProperties */
        OrderSummaryFields: {
            /** Format: uuid */
            id: string;
            number: number;
            status: components["schemas"]["OrderStatus"];
            frozen: boolean;
            owner: components["schemas"]["Person"];
            isMine: boolean;
            /** @description x-requires: order:view:any，本人也能看 */
            fileName?: string;
            plate: components["schemas"]["Plate"];
            colourPref: components["schemas"]["ColourPref"];
            bedType?: string | null;
            /** Format: date-time */
            submittedAt: string;
            /** @description 申请者只看到自己的排位和前面几单；wait 受 queue:wait:view */
            queue?: {
                position: number;
                ahead: number;
                wait: {
                    minSeconds: number;
                    maxSeconds: number;
                } | null;
            } | null;
            printer?: {
                /** Format: uuid */
                id: string;
                name: string;
                state: components["schemas"]["PrinterState"];
                reasons: components["schemas"]["AttentionReason"][];
            } | null;
            progress?: {
                percent: number;
                remainingSeconds: number | null;
            } | null;
        };
        OrderSummary: components["schemas"]["OrderSummaryFields"];
        TimelineNode: {
            node: components["schemas"]["ProcessNode"];
            state: components["schemas"]["NodeState"];
            /** @description 审核节点：第 N 版 · 状态 */
            label: string | null;
            note: string | null;
        };
        OrderDetail: components["schemas"]["OrderSummaryFields"] & {
            activeVersion: components["schemas"]["OrderVersion"];
            pendingVersion?: components["schemas"]["OrderVersion"] | null;
            versions: components["schemas"]["OrderVersion"][];
            /** @description 本人、审核人、管理员可见 */
            answers?: components["schemas"]["Answer"][];
            revisions: {
                used: number;
                max: number;
                modelSwitches: number;
                maxModelSwitches: number;
            };
            /** @description 6 个流程节点 */
            nodes: components["schemas"]["TimelineNode"][];
            /** @description x-requires: order:review */
            findings?: components["schemas"]["Finding"][];
            /** @description 入库信息。入库照片订单本人也能看，前端放在入库节点下 */
            storage?: {
                slot: string;
                /**
                 * Format: uri
                 * @description 短期签名链接，本人、现场人员、管理员可见
                 */
                photoUrl: string | null;
            } | null;
            parts?: {
                total: number;
                skipped: number[];
                canSkip: boolean;
            } | null;
            /** @description 当前用户此刻能做的操作的 operationId，前端据此显示按钮 */
            actions: string[];
            /** @description 打印记录：这个订单的每个打印任务，最新的在前。任务阶段不单独显示。endPhoto 订单本人也能看，前端放在打印节点下；默认只展开最新一次，之前的折叠 */
            printJobs?: {
                /** Format: uuid */
                jobId: string;
                /** @description 第 N 次 */
                attempt: number;
                printerName: string;
                /** Format: date-time */
                startedAt: string | null;
                /** Format: date-time */
                endedAt: string | null;
                /** @enum {string|null} */
                outcome: "SEND_FAILED" | "START_FAILED" | "STOPPED_BEFORE_START" | "FAILED" | "FINISHED" | null;
                endPhoto: {
                    /** Format: date-time */
                    capturedAt: string;
                    /**
                     * Format: uri
                     * @description 短期签名链接
                     */
                    url: string;
                } | null;
            }[];
            /** @description 如 file_expired、archived、declined */
            reprintBlockedReason?: string | null;
            /** @description 现场人员点了不重打。reason 按 reasonVisible 对申请者裁剪 */
            reprintDeclined?: {
                /** Format: date-time */
                at: string;
                by: components["schemas"]["Person"] | null;
                reason: string | null;
            } | null;
        };
        OrderRecord: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            at: string;
            node: components["schemas"]["ProcessNode"];
            /** @description 记录类型，如 order.approved */
            kind: string;
            actor?: components["schemas"]["Person"] | null;
            fromStatus?: components["schemas"]["OrderStatus"] | null;
            toStatus?: components["schemas"]["OrderStatus"] | null;
            versionN?: number | null;
            note?: string | null;
            /** @description 申请者只收到 noteVisible=true 的备注 */
            noteVisible: boolean;
            data: {
                [key: string]: unknown;
            };
        };
        Timelapse: {
            /** Format: uuid */
            id: string;
            part: number;
            sizeBytes: number;
            /** Format: date-time */
            createdAt: string;
        };
        QueueEntry: {
            order: components["schemas"]["OrderSummary"];
            sortKey: string;
            frozen: boolean;
            /** Format: date-time */
            bypassedSince: string | null;
        };
        Suggestion: {
            /** Format: uuid */
            printerId: string;
            /** Format: uuid */
            orderId: string;
        };
        TrayRef: {
            /** @description AMS 编号；外挂料 = -1 */
            unit: number;
            slot: number;
        };
        Tray: {
            unit: number;
            slot: number;
            label: string;
            material?: string | null;
            subType?: string | null;
            colour?: string | null;
            /** @description 面板记的槽位克数，不是打印机估的余量 */
            remainingGrams: number;
            /** @description 换料后重置为默认净重、还没人确认 */
            gramsUnconfirmed: boolean;
            /** @description 料位信息是否来自 RFID 识别；RFID 料位只能查看，不能改 */
            rfid: boolean;
            /** @description RFID 耗材卷的序列号（拓竹 `tray_uuid`），只读显示；非 RFID 料位为 null */
            serial: string | null;
            extruders: number[];
        };
        /** @description BLOCK = 物理约束或配置为拦下；物理约束没有放行 */
        MappingCheck: {
            /** @enum {string} */
            rule: "REACH" | "EMPTY" | "NOZZLE" | "DUPLICATE" | "MATERIAL" | "SUB_TYPE" | "COLOUR" | "REMAINING";
            /** @enum {string} */
            result: "OK" | "WARN" | "BLOCK";
            deltaE?: number | null;
        };
        MappingEntry: {
            sliceSlot: number;
            extruder?: number | null;
            tray: components["schemas"]["TrayRef"];
            /** @description 设置里「映射不符的原因列表」中的一项；有 WARN 时必选 */
            mismatchReason?: string | null;
            /** @default true */
            reasonVisibleToApplicant: boolean;
        };
        DispatchOptions: {
            /** Format: uuid */
            printerId: string;
            /** Format: uuid */
            orderId: string;
            feasible: boolean;
            /** @description 不能派的原因 */
            blockers: {
                code: string;
                rule: string;
            }[];
            /** @description 板型。打印机没报板型时由现场人员确认；和订单要求不一致时要二次确认 */
            bedType: {
                reported: string | null;
                required: string | null;
                needsConfirmation: boolean;
            };
            trays: components["schemas"]["Tray"][];
            proposal: {
                entry: components["schemas"]["MappingEntry"];
                checks: components["schemas"]["MappingCheck"][];
            }[];
            /** @description 按当前限值复核 */
            safety: {
                /** @enum {string} */
                verdict: "PASS" | "WARN" | "REJECT";
                findings: components["schemas"]["Finding"][];
            };
            /** @description 派这一单会越过的排队中订单 */
            bypasses: string[];
        };
        ActiveError: {
            errorId: string;
            vendorCode: string;
            channel: string;
            /** @enum {string} */
            severity: "fatal" | "error" | "warning" | "info";
            module?: string | null;
            message?: string | null;
            helpUrl?: string | null;
            actions: {
                action: string;
                label: string;
                requiresOnSite: boolean;
                destructive: boolean;
            }[];
            /** Format: date-time */
            raisedAt: string;
        };
        ControlSpec: {
            action: string;
            /** @enum {string} */
            category: "light" | "temperature" | "fan" | "speed" | "pause" | "resume" | "filament" | "dry" | "motion" | "tray";
            /** @description 参数的 JSON Schema */
            args: {
                [key: string]: unknown;
            };
            destructive: boolean;
            /** @description 按控制的类别和打印机上报的状态算出的此刻能不能点 */
            enabled: boolean;
        };
        /** @description PrinterCard 和 PrinterDetail 共用的字段，本身不封闭 */
        PrinterCardFields: {
            /** Format: uuid */
            id: string;
            name: string;
            modelName?: string | null;
            state: components["schemas"]["PrinterState"];
            /** Format: date-time */
            stateSince: string;
            pauseReason?: components["schemas"]["PauseReason"] | null;
            /** @description 异常原因；空 = 不在异常 */
            reasons?: components["schemas"]["AttentionReason"][];
            /** @description 工作（外部任务） */
            externalRunning?: boolean;
            starred: boolean;
            openToApplicants: boolean;
            job?: {
                /** Format: uuid */
                orderId: string | null;
                orderNumber: number | null;
                owner: components["schemas"]["Person"] | null;
                /** @description x-requires: overview:filename:view（访客看「访客可看打印中的文件名」设置）。本系统派的任务 = 选手上传时的原文件名，不是打印机上的 pr-<jobRef 后 12 位> 文件名；external 为 true 时是打印机上报的文件名，只给 order:view:any */
                fileName?: string;
                external: boolean;
                percent: number | null;
                remainingSeconds: number | null;
                layer?: number | null;
                totalLayers?: number | null;
                /**
                 * Format: uuid
                 * @description 本系统派的任务的 ID，停止时作为 expectedJobId 带回；外部任务为 null
                 */
                jobId?: string | null;
                /**
                 * @description 任务阶段，按打印机上报推进；外部任务为 null
                 * @enum {string|null}
                 */
                phase?: "TRANSFERRING" | "PREPARING" | "PRINTING" | "PAUSED" | null;
                /**
                 * @description 暂停前所在的阶段，只在 phase 为 PAUSED 时有值
                 * @enum {string|null}
                 */
                pausedFrom?: "PREPARING" | "PRINTING" | null;
                /** @description 打印机上报的准备子阶段（如加热、调平），原样透传 */
                substage?: string | null;
            } | null;
            temps?: {
                [key: string]: {
                    current: number;
                    target?: number | null;
                };
            };
            /** @description 卡片平时显示抓拍，点播放才申请实况 */
            camera: {
                /** @enum {string} */
                stream: "video" | "jpeg-frames" | "none";
                /** Format: date-time */
                snapshotAt: string | null;
            };
            /** @description 能不能点开详情 */
            openable: boolean;
        };
        PrinterCard: components["schemas"]["PrinterCardFields"];
        PrinterDetail: components["schemas"]["PrinterCardFields"] & {
            brand: string;
            serial: string;
            host: string;
            daemon: {
                /** Format: uuid */
                id: string;
                name: string;
                online: boolean;
            };
            /**
             * Format: date-time
             * @description 停用时间
             */
            disabledAt?: string | null;
            modelId?: string | null;
            nozzles: components["schemas"]["Nozzle"][];
            trays: components["schemas"]["Tray"][];
            bedType?: string | null;
            storage: {
                /** @enum {string} */
                medium: "internal" | "sd" | "usb";
                present: boolean;
                writable: boolean;
                freeBytes: number | null;
            }[];
            /** @description 异常的全部原因，每个原因一条；界面合成一个异常，点开列出 */
            attention: {
                reason: components["schemas"]["AttentionReason"];
                /** Format: date-time */
                since: string;
                /** Format: uuid */
                jobId: string | null;
                /** @description 维护原因等 */
                note: string | null;
            }[];
            activeErrors: components["schemas"]["ActiveError"][];
            controls: components["schemas"]["ControlSpec"][];
            maintenanceReason?: string | null;
            /** @description 只说有没有，永远不返回访问码 */
            accessCode: {
                set: boolean;
                keyMatches: boolean;
            };
            /** Format: uuid */
            currentDispatchId?: string | null;
            version: number;
            /** Format: date-time */
            lastReportAt?: string | null;
        };
        DiscoveredPrinter: {
            brand: string;
            serial: string;
            host: string;
            modelId: string | null;
            name: string | null;
            /** Format: date-time */
            lastSeenAt: string;
            claimedBy: {
                /** Format: uuid */
                daemonId: string;
                /** Format: uuid */
                printerId: string;
            } | null;
        };
        PickupCode: {
            /** @description 只在签发时返回一次 */
            code: string;
            /** Format: date-time */
            expiresAt: string;
        };
        PickupLookup: {
            order: components["schemas"]["OrderSummary"];
            storageSlot: string;
            /** Format: uri */
            photoUrl: string | null;
            /** Format: date-time */
            codeExpiresAt: string;
        };
        Overview: {
            printers: components["schemas"]["PrinterCard"][];
            queue: {
                waiting: number;
                /** @description x-requires: order:review */
                pendingReview?: number;
                /**
                 * Format: date-time
                 * @description x-requires: settings:manage。数据恢复到的时间，有值时管理员看到横幅"数据已恢复到 <时间>，之后提交的订单需要选手重新提交"
                 */
                restoredTo?: string | null;
            };
        };
        CatalogRow: {
            /** Format: uuid */
            id: string | null;
            /** @enum {string} */
            source: "AUTO" | "STOCK";
            autoKey: string | null;
            modelIds: string[];
            material: string;
            subType: string | null;
            colour: string;
            colourName: string | null;
            /** @description 已装上 / 需要换料 */
            loaded: boolean;
            hidden: boolean;
            sort: number;
            note: string | null;
            version: number | null;
        };
        Resources: {
            printers: {
                modelId: string;
                modelName: string;
                nozzles: components["schemas"]["Nozzle"][];
                count: number;
                available: number;
                /** @description 这个机型本场能用的板型 */
                bedTypes: string[];
            }[];
            catalog: components["schemas"]["CatalogRow"][];
            wait: {
                minSeconds: number;
                maxSeconds: number;
            } | null;
            /** @description 自选板打开时为各机型板型的并集；提交页按选中各盘的机型取交集 */
            bedTypes: string[] | null;
        };
        TodoItem: {
            /** @enum {string} */
            kind: "REVIEW" | "STORE" | "ATTENTION" | "PAUSED_TOO_LONG" | "START_UNCONFIRMED" | "BYPASSED" | "UNCLAIMED" | "CLEAR_BED" | "LOW_FILAMENT";
            /** Format: date-time */
            since: string;
            /** Format: uuid */
            orderId: string | null;
            /** Format: uuid */
            printerId: string | null;
            data: {
                [key: string]: unknown;
            };
        };
        User: {
            /** Format: uuid */
            id: string;
            username: string;
            displayName: string;
            email: string | null;
            phone: string | null;
            role: components["schemas"]["Role"];
            /** Format: uri */
            avatarUrl: string | null;
            disabled: boolean;
            /** Format: date-time */
            createdAt: string;
            version: number;
        };
        Me: {
            user: components["schemas"]["User"];
            locale: string;
            /** @description 按角色和设置开关算好的权限节点 */
            permissions: components["schemas"]["Permission"][];
        };
        AuthMethods: {
            register: ("OIDC" | "OPEN" | "INVITE" | "PHONE")[];
            oidc: {
                id: string;
                displayName: string;
            }[];
            emailDomains: string[] | null;
            setupRequired: boolean;
        };
        Invite: {
            /** Format: uuid */
            id: string;
            label: string;
            maxUses: number;
            usedCount: number;
            /** Format: date-time */
            expiresAt: string | null;
            /** Format: date-time */
            revokedAt: string | null;
            /** Format: date-time */
            createdAt: string;
            /** @description 只在创建时返回一次 */
            code?: string;
        };
        Daemon: {
            /** Format: uuid */
            id: string;
            name: string;
            online: boolean;
            daemonVersion: string | null;
            protocolVersion: string | null;
            platform: string | null;
            /** Format: date-time */
            lastSeenAt: string | null;
            /** Format: date-time */
            revokedAt: string | null;
            /**
             * Format: date-time
             * @description 疑似私钥泄露告警，不自动吊销
             */
            keyAlertAt?: string | null;
            keyFingerprint: string;
            printerCount: number;
            needsUpgrade: boolean;
            version: number;
        };
        Enrollment: {
            /** Format: uuid */
            id: string;
            /** Format: date-time */
            expiresAt: string;
            /** @description 一次性令牌放在环境变量里；只在创建时返回 */
            commands: {
                linux: string;
                windows: string;
                docker: string;
            };
        };
        /** @enum {string} */
        FormFieldType: "text" | "textarea" | "single" | "multi" | "number";
        FormField: {
            id: string;
            label: string;
            type: components["schemas"]["FormFieldType"];
            required: boolean;
            options?: string[];
        };
        Form: {
            /** Format: uuid */
            versionId: string;
            fields: components["schemas"]["FormField"][];
            /** Format: date-time */
            createdAt: string;
        };
        SettingsSection: {
            /** @enum {string} */
            section: "general" | "ui" | "camera" | "submit" | "queue" | "revision" | "mapping" | "printing" | "pickup" | "files" | "accounts" | "notifications" | "ops";
            /** @description 键是参数的英文名，定义表见代码 */
            values: {
                [key: string]: unknown;
            };
            defaults: {
                [key: string]: unknown;
            };
            version: number;
            /** Format: date-time */
            updatedAt: string | null;
            updatedBy: components["schemas"]["Person"] | null;
        };
        PublicSettings: {
            orgName: string;
            timezone: string;
            defaultLocale: string;
            overviewPublic: boolean;
            guestStream: boolean;
        };
        AuditEntry: {
            id: number;
            /** Format: date-time */
            at: string;
            /** @enum {string} */
            actorType: "USER" | "SYSTEM" | "DAEMON" | "PRINTER";
            actor: components["schemas"]["Person"] | null;
            action: string;
            targetType: string | null;
            targetId: string | null;
            before: unknown;
            after: unknown;
            reason: string | null;
            /** @enum {string} */
            result: "OK" | "FAILED" | "DENIED";
            requestId: string | null;
            ip: string | null;
        };
        Notification: {
            /** Format: uuid */
            id: string;
            event: string;
            /** Format: uuid */
            orderId: string | null;
            /** Format: uuid */
            printerId: string | null;
            data: {
                [key: string]: unknown;
            };
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            readAt: string | null;
        };
        NotificationPref: {
            event: string;
            /** @enum {string} */
            channel: "IN_APP" | "EMAIL" | "FEISHU";
            enabled: boolean;
            /** @description 驳回、可取件的站内通知关不掉 */
            locked?: boolean;
        };
    };
    responses: {
        /** @description 错误 */
        Problem: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description 命令已发出 */
        Accepted: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["CommandAccepted"];
            };
        };
        /** @description 成功 */
        NoContent: {
            headers: {
                [name: string]: unknown;
            };
            content?: never;
        };
    };
    parameters: {
        OrderId: string;
        PrinterId: string;
        VersionN: number;
        Limit: number;
        Cursor: string;
        /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
        IdempotencyKey: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getAuthMethods: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthMethods"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    setup: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    username: string;
                    password: string;
                    displayName: string;
                    orgName: string;
                    timezone: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    username: string;
                    password: string;
                    captcha?: {
                        challengeId: string;
                        answer: string;
                    };
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: components["responses"]["NoContent"];
            default: components["responses"]["Problem"];
        };
    };
    issueCaptcha: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        challengeId: string;
                        payload: unknown;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    sendOtp: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    channel: "SMS" | "EMAIL";
                    target: string;
                    /** @enum {string} */
                    purpose: "REGISTER" | "VERIFY_EMAIL" | "RESET_PASSWORD";
                    captcha?: {
                        challengeId: string;
                        answer: string;
                    };
                };
            };
        };
        responses: {
            204: components["responses"]["NoContent"];
            default: components["responses"]["Problem"];
        };
    };
    register: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    method: "OPEN" | "INVITE" | "PHONE";
                    username: string;
                    password?: string;
                    displayName: string;
                    email?: string;
                    inviteCode?: string;
                    phone?: string;
                    otp?: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    oidcStart: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                provider: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 跳到提供方 */
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["Problem"];
        };
    };
    oidcCallback: {
        parameters: {
            query?: {
                code?: string;
                state?: string;
            };
            header?: never;
            path: {
                provider: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 登录完成，跳回界面 */
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["Problem"];
        };
    };
    getMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    updateMe: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                    displayName?: string;
                    /** @enum {string} */
                    locale?: "zh-CN" | "en";
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    changePassword: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    current: string;
                    next: string;
                };
            };
        };
        responses: {
            204: components["responses"]["NoContent"];
            default: components["responses"]["Problem"];
        };
    };
    setAvatar: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    file: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Me"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getNotificationPrefs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationPref"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    setNotificationPrefs: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    prefs: components["schemas"]["NotificationPref"][];
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationPref"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    uploadFile: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    file: string;
                    captchaChallengeId?: string;
                    captchaAnswer?: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileCheck"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getFileCheck: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                fileId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["FileCheck"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listOrders: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
                status?: string;
                ownerId?: string;
                printerId?: string;
                number?: number;
                /** @description 搜文件名、申请者 */
                q?: string;
                submittedFrom?: string;
                submittedTo?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["OrderSummary"][];
                        nextCursor: string | null;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    submitOrders: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    fileId: string;
                    plates: number[];
                    colourPref: components["schemas"]["ColourPref"];
                    bedType?: string | null;
                    /** Format: uuid */
                    formVersionId: string;
                    answers: {
                        fieldId: string;
                        value: unknown;
                    }[];
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        orders: components["schemas"]["OrderSummary"][];
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listMyOrders: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
                /** @description 逗号分隔的状态 */
                status?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["OrderSummary"][];
                        nextCursor: string | null;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listOrderRecords: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderRecord"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    addDeviceStopNote: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    refRecordId: string;
                    note: string;
                    /** @default false */
                    noteVisible?: boolean;
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderRecord"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    downloadVersionFile: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["parameters"]["OrderId"];
                n: components["parameters"]["VersionN"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 跳到签名链接 */
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["Problem"];
        };
    };
    getOrderParts: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        parts: components["schemas"]["Part"][];
                        /** Format: uri */
                        topUrl: string | null;
                        /** Format: uri */
                        pickUrl: string | null;
                        skipped: number[];
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    approveOrder: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedStatus: components["schemas"]["OrderStatus"];
                    /** Format: uuid */
                    versionId: string;
                    /** @description 备注 */
                    note?: string | null;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    rejectOrder: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedStatus: components["schemas"]["OrderStatus"];
                    /** Format: uuid */
                    versionId: string;
                    reason: string;
                    /** @default true */
                    reasonVisible?: boolean;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    reviseOrder: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedStatus: components["schemas"]["OrderStatus"];
                    /** Format: uuid */
                    fileId: string;
                    plate: number;
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    withdrawRevision: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedStatus: components["schemas"]["OrderStatus"];
                    /** Format: uuid */
                    versionId: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    restoreVersion: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
                n: components["parameters"]["VersionN"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedStatus: components["schemas"]["OrderStatus"];
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    cancelOrder: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedStatus: components["schemas"]["OrderStatus"];
                    reason: string;
                    /** @default true */
                    reasonVisible?: boolean;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    reprintOrder: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    expectedStatus: "FAILED";
                    /** @description 备注 */
                    note?: string | null;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    declineReprint: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    expectedStatus: "FAILED";
                    reason: string;
                    /** @default true */
                    reasonVisible?: boolean;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    revokeReprintDecline: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    reconcileOrder: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description 已派单也能人工对账
                     * @enum {string}
                     */
                    expectedStatus: "DISPATCHED" | "PRINTING";
                    /** @enum {string} */
                    outcome: "FAILED" | "PRINTED" | "NOT_STARTED";
                    /** @description 原因，必填，写审计 */
                    note: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    skipParts: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    expectedStatus: "PRINTING";
                    /**
                     * Format: uuid
                     * @description 防止跳到重打后的新任务上；对不上 409 job_mismatch
                     */
                    expectedJobId: string;
                    partIds: number[];
                };
            };
        };
        responses: {
            202: components["responses"]["Accepted"];
            default: components["responses"]["Problem"];
        };
    };
    storeOrder: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** @enum {string} */
                    expectedStatus: "PRINTED";
                    slot: string;
                    /** @enum {string} */
                    bedCleared: "true";
                    photo: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    disposeOrder: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedStatus: components["schemas"]["OrderStatus"];
                    reason: string;
                    /** @default false */
                    reasonVisible?: boolean;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    issuePickupCode: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    expectedStatus: "READY";
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PickupCode"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listTimelapses: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["parameters"]["OrderId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Timelapse"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    viewTimelapse: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                orderId: components["parameters"]["OrderId"];
                timelapseId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 跳到签名链接；每次记审计 */
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["Problem"];
        };
    };
    getQueue: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueueEntry"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    reorderQueue: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    orderId: string;
                    /** Format: uuid */
                    afterOrderId: string | null;
                    expectedStatus: components["schemas"]["OrderStatus"];
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["QueueEntry"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getDispatchSuggestions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Suggestion"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getDispatchOptions: {
        parameters: {
            query?: {
                orderId?: string;
            };
            header?: never;
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DispatchOptions"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    dispatchOrder: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    orderId: string;
                    /** @enum {string} */
                    expectedStatus: "QUEUED";
                    /** @enum {string} */
                    expectedState: "AVAILABLE";
                    bedType?: string | null;
                    /** @default false */
                    bedTypeMismatchConfirmed?: boolean;
                    mapping: components["schemas"]["MappingEntry"][];
                };
            };
        };
        responses: {
            202: components["responses"]["Accepted"];
            default: components["responses"]["Problem"];
        };
    };
    listPrinters: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterDetail"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    createPrinter: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    daemonId: string;
                    brand: string;
                    serial: string;
                    host: string;
                    name: string;
                    /** @description 浏览器用 daemon 公钥加密，面板只存密文 */
                    accessCodeCipher: string;
                    keyFingerprint: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getPrinter: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    deletePrinter: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                };
            };
        };
        responses: {
            204: components["responses"]["NoContent"];
            default: components["responses"]["Problem"];
        };
    };
    updatePrinter: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                    name?: string;
                    host?: string;
                    /** Format: uuid */
                    daemonId?: string;
                    accessCodeCipher?: string;
                    keyFingerprint?: string;
                    disabled?: boolean;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    setPrinterOpen: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                    open: boolean;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    setTrayGrams: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
                /** @description AMS 编号；外挂料 = -1 */
                unit: number;
                slot: number;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    grams: number;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Tray"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    setPrinterStar: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    starred: boolean;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterCard"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    enterMaintenance: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedState: components["schemas"]["PrinterState"];
                    reason: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    exitMaintenance: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    expectedState: "ATTENTION";
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    stopPrint: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    expectedState: components["schemas"]["PrinterState"];
                    /**
                     * Format: uuid
                     * @description 用户看到的当前任务；锁行后和状态一起核对，对不上 409 job_mismatch。外部任务时不带
                     */
                    expectedJobId?: string;
                    reason: string;
                    /** @default true */
                    reasonVisible?: boolean;
                };
            };
        };
        responses: {
            202: components["responses"]["Accepted"];
            default: components["responses"]["Problem"];
        };
    };
    resolveError: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
                errorId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description 必须是这条报错的 actions 之一 */
                    action: string;
                    /** @default false */
                    onSiteConfirmed?: boolean;
                };
            };
        };
        responses: {
            202: components["responses"]["Accepted"];
            default: components["responses"]["Problem"];
        };
    };
    controlPrinter: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    action: string;
                    args: {
                        [key: string]: unknown;
                    };
                };
            };
        };
        responses: {
            202: components["responses"]["Accepted"];
            default: components["responses"]["Problem"];
        };
    };
    refreshPrinter: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            202: components["responses"]["Accepted"];
            default: components["responses"]["Problem"];
        };
    };
    getPrinterStorage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 用量和文件列表 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        media: {
                            /**
                             * @example internal
                             * @example sd
                             */
                            medium: string;
                            present: boolean;
                            freeBytes?: number;
                            totalBytes?: number;
                        }[];
                        files: {
                            medium?: string;
                            /** @description 打印机上的路径 */
                            name: string;
                            sizeBytes?: number;
                            /** Format: date-time */
                            modifiedAt?: string;
                            /** @description 是否系统文件 */
                            system: boolean;
                        }[];
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    releasePrinter: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    expectedState: "ATTENTION";
                    /**
                     * Format: uuid
                     * @description 用户看到的当前任务；对不上 409 job_mismatch
                     */
                    expectedJobId?: string | null;
                    /**
                     * @description 当前任务的判定
                     * @enum {string|null}
                     */
                    outcome?: "FAILED" | "PRINTED" | "NOT_STARTED" | null;
                    /** @description 必填，写进审计 */
                    reason: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listPrinterEvents: {
        parameters: {
            query?: {
                cursor?: string;
            };
            header?: never;
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            kind: "PAUSED" | "RESUMED" | "ERROR" | "HMS" | "CONNECTION_DOWN" | "CONNECTION_UP" | "REFILL";
                            /** Format: date-time */
                            at: string;
                            /** Format: uuid */
                            jobId: string | null;
                            data: Record<string, never>;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    confirmBedCleared: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    expectedState: "CLEARING_REQUIRED";
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PrinterDetail"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listPrinterErrors: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            error: components["schemas"]["ActiveError"];
                            /** Format: date-time */
                            clearedAt: string | null;
                            /** @enum {string|null} */
                            clearedBy: "PANEL" | "DEVICE" | "UNKNOWN" | null;
                            resolvedAction: string | null;
                            resolvedBy: components["schemas"]["Person"] | null;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    putPrinterPresence: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description 这个浏览器 SSE 连接的 ID，用来区分同一个人开的多个页面 */
                    streamId: string;
                };
            };
        };
        responses: {
            /** @description 已记下 */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["Problem"];
        };
    };
    deletePrinterPresence: {
        parameters: {
            query: {
                streamId: string;
            };
            header?: never;
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 已去掉 */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["Problem"];
        };
    };
    listPrinterJobs: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            jobId: string;
                            /** @description 这个订单的第 N 次 */
                            attempt: number;
                            /** Format: uuid */
                            orderId: string;
                            orderNumber: number;
                            owner: components["schemas"]["Person"] | null;
                            /** @enum {string} */
                            phase: "TRANSFERRING" | "PREPARING" | "PRINTING" | "PAUSED" | "ENDED";
                            /** @enum {string|null} */
                            outcome: "SEND_FAILED" | "START_FAILED" | "STOPPED_BEFORE_START" | "FAILED" | "FINISHED" | null;
                            /** Format: date-time */
                            dispatchedAt: string;
                            /** Format: date-time */
                            startedAt: string | null;
                            /** Format: date-time */
                            endedAt: string | null;
                            endPhoto: {
                                /** Format: date-time */
                                capturedAt: string;
                                /**
                                 * Format: uri
                                 * @description 短期签名链接
                                 */
                                url: string;
                            } | null;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    openCameraSession: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": Record<string, never>;
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @enum {string} */
                        kind: "video";
                        /** Format: uri */
                        whepUrl: string | null;
                        /** Format: uri */
                        hlsUrl: string | null;
                        /** @enum {string} */
                        prefer: "webrtc" | "llhls";
                        token: string;
                        /** Format: date-time */
                        expiresAt: string;
                        /** @enum {string|null} */
                        transport: "srt" | "rtsps" | null;
                    } | {
                        /** @enum {string} */
                        kind: "jpeg-frames";
                        /** Format: uri */
                        wsUrl: string;
                        /** Format: date-time */
                        expiresAt: string;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    cameraSnapshot: {
        parameters: {
            query?: never;
            header?: {
                "If-None-Match"?: string;
            };
            path: {
                printerId: components["parameters"]["PrinterId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 内存里最新一张 JPEG */
            200: {
                headers: {
                    "X-Captured-At"?: string;
                    ETag?: string;
                    [name: string]: unknown;
                };
                content: {
                    "image/jpeg": string;
                };
            };
            /** @description 没变 */
            304: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            default: components["responses"]["Problem"];
        };
    };
    listRedemptions: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            order: components["schemas"]["OrderSummary"];
                            /** Format: date-time */
                            redeemedAt: string;
                            redeemedBy: components["schemas"]["Person"];
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    lookupPickup: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PickupLookup"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    redeemPickup: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                code: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    expectedStatus: "READY";
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderSummary"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getOverview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Overview"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getResources: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Resources"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getTodo: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TodoItem"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getCatalog: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogRow"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    createStockRow: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    modelIds: string[];
                    material: string;
                    subType?: string | null;
                    colour: string;
                    colourName?: string | null;
                    note?: string | null;
                    sort?: number;
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogRow"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    deleteCatalogRow: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                rowId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                };
            };
        };
        responses: {
            204: components["responses"]["NoContent"];
            default: components["responses"]["Problem"];
        };
    };
    updateCatalogRow: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                rowId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                    modelIds?: string[];
                    material?: string;
                    subType?: string | null;
                    colour?: string;
                    colourName?: string | null;
                    hidden?: boolean;
                    sort?: number;
                    note?: string | null;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogRow"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    setAutoRow: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                autoKey: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number | null;
                    hidden: boolean;
                    sort: number;
                    note?: string | null;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogRow"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    setModelBedTypes: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                modelId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    bedTypes: string[];
                };
            };
        };
        responses: {
            204: components["responses"]["NoContent"];
            default: components["responses"]["Problem"];
        };
    };
    listUsers: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
                q?: string;
                role?: components["schemas"]["Role"];
                disabled?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["User"][];
                        nextCursor: string | null;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    updateUser: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                    role?: components["schemas"]["Role"];
                    disabled?: boolean;
                    reason?: string | null;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["User"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listInvites: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Invite"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    createInvite: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    label: string;
                    maxUses: number;
                    /** Format: date-time */
                    expiresAt: string | null;
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Invite"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    revokeInvite: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                inviteId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: components["responses"]["NoContent"];
            default: components["responses"]["Problem"];
        };
    };
    listDaemons: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Daemon"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    createEnrollment: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Enrollment"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    updateDaemon: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                daemonId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                    name: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Daemon"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    revokeDaemon: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                daemonId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                    reason: string;
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Daemon"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getDaemonPublicKey: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                daemonId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description SPKI DER base64 */
                        publicKey: string;
                        keyFingerprint: string;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listDiscovered: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                daemonId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DiscoveredPrinter"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getForm: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Form"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    saveForm: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** Format: uuid */
                    basedOnVersionId: string;
                    fields: components["schemas"]["FormField"][];
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Form"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getPublicSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PublicSettings"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    getSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsSection"][];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    saveSettingsSection: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path: {
                section: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    version: number;
                    values: {
                        [key: string]: unknown;
                    };
                    /**
                     * @description 前端已显示改前改后并经确认
                     * @enum {string}
                     */
                    confirm: "true";
                };
            };
        };
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SettingsSection"];
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listAudit: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
                action?: string;
                actorId?: string;
                targetType?: string;
                targetId?: string;
                from?: string;
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["AuditEntry"][];
                        nextCursor: string | null;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    archivePeriod: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @enum {string} */
                    confirm: "true";
                    export: boolean;
                };
            };
        };
        responses: {
            /** @description 成功 */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        archiveId: string;
                        cancelled: number;
                        disposed: number;
                        /** Format: uri */
                        exportUrl: string | null;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    listNotifications: {
        parameters: {
            query?: {
                limit?: components["parameters"]["Limit"];
                cursor?: components["parameters"]["Cursor"];
                unread?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description 成功 */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: components["schemas"]["Notification"][];
                        nextCursor: string | null;
                    };
                };
            };
            default: components["responses"]["Problem"];
        };
    };
    markNotificationsRead: {
        parameters: {
            query?: never;
            header: {
                /** @description 幂等键，客户端生成，一次用户意图一个；网络重试和连点都用同一个 */
                "Idempotency-Key": components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    ids?: string[];
                    all?: boolean;
                };
            };
        };
        responses: {
            204: components["responses"]["NoContent"];
            default: components["responses"]["Problem"];
        };
    };
    stream: {
        parameters: {
            query?: never;
            header?: {
                "Last-Event-ID"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description text/event-stream */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            default: components["responses"]["Problem"];
        };
    };
}
