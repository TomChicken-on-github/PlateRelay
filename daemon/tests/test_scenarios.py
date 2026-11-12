"""故障和现场操作：真 daemon + 模拟打印机 + 假面板。

"现场的人"通过模拟打印机的现场接口动手（sim.operate / sim.printer.operator_*），
daemon 只能从打印机的局域网接口看到后果。
"""

from __future__ import annotations

import asyncio

from test_main_flow import CONTENT, connect

from platerelay_daemon.link import new_id
from platerelay_daemon.printers import file_name


async def start(panel, printer_id, snapshot, **kwargs):
    return await panel.start_job(printer_id, panel.add_file(CONTENT), expected_run_seq=snapshot["runSeq"], **kwargs)


async def settle(seconds: float = 0.5) -> None:
    await asyncio.sleep(seconds)


# 停止


async def test_stop_while_transferring_cancels_before_start(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    panel.download_delay = 1.0
    job_ref, command_id = await start(panel, printer_id, snapshot)
    await panel.wait_snapshot(printer_id, lambda item: item.get("pendingStarts") == [{"jobRef": job_ref, "stage": "DOWNLOADING"}])

    stop_id = await panel.command(printer_id, "job.stop", {"jobRef": job_ref})
    cancelled = await panel.wait_event("job.cancelled", jobRef=job_ref)
    assert cancelled["data"] == {"commandId": stop_id, "beforeStart": True}

    await settle(1.5)
    assert sim.printer.state == "idle" and sim.printer.history == []
    assert file_name(job_ref) not in sim.printer.files
    assert not panel.events("job.staged")


async def test_stop_while_printing_is_sent_to_the_printer(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    job_ref, _ = await start(panel, printer_id, snapshot)
    await panel.wait_event("job.started", jobRef=job_ref)

    stop_id = await panel.command(printer_id, "job.stop", {"jobRef": job_ref})
    cancelled = await panel.wait_event("job.cancelled", jobRef=job_ref)
    assert cancelled["data"] == {"commandId": stop_id, "beforeStart": False}
    assert sim.printer.state == "stopped"


async def test_stop_for_a_job_that_is_not_running_never_touches_the_printer(panel, sim, harness):
    printer_id, _ = await connect(panel, sim, harness)
    sim.printer.operator_starts_local_print("someone-elses.gcode.3mf")
    await panel.wait_event("external.started")

    stop_id = await panel.command(printer_id, "job.stop", {"jobRef": new_id()})
    await panel.wait_result(stop_id, "done")
    assert sim.printer.state in ("preparing", "printing")  # 别人的任务没被停掉


async def test_stop_pressed_on_the_printer_has_no_command_id(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    job_ref, _ = await start(panel, printer_id, snapshot)
    await panel.wait_snapshot(printer_id, lambda item: item["state"] == "PREPARING")

    await sim.operate("press_stop")
    cancelled = await panel.wait_event("job.cancelled", jobRef=job_ref)
    assert cancelled["data"] == {"beforeStart": True}


# 暂停、报错


async def test_pause_and_resume_on_the_printer(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    job_ref, _ = await start(panel, printer_id, snapshot)
    await panel.wait_event("job.started", jobRef=job_ref)

    await sim.operate("press_pause")
    paused = await panel.wait_event("job.paused", jobRef=job_ref)
    assert paused["data"] == {"reason": "USER"}
    await sim.operate("press_resume")
    await panel.wait_event("job.resumed", jobRef=job_ref)
    await panel.wait_event("job.finished", jobRef=job_ref)


async def test_filament_runout_pauses_until_someone_reloads_and_confirms(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    job_ref, _ = await start(panel, printer_id, snapshot)
    await panel.wait_event("job.started", jobRef=job_ref)

    sim.printer.operator_filament_runs_out(unit=0, slot=0)
    paused = await panel.wait_event("job.paused", jobRef=job_ref)
    assert paused["data"] == {"reason": "RUNOUT"}
    raised = await panel.wait_event("error.raised", jobRef=job_ref)
    error = raised["data"]["error"]
    assert error["blocksJob"] is True and error["vendorCode"] == "0700-2000"
    assert [action["action"] for action in error["actions"]] == ["RESUME_PROBLEM_SOLVED", "STOP"]

    # 没装料就点继续：打印机拒绝，原话带回面板
    refused = await panel.command(printer_id, "error.resolve", {"errorId": error["errorId"], "action": "RESUME_PROBLEM_SOLVED"})
    result = await panel.wait_result(refused, "failed")
    assert result["message"] == "Filament has not been loaded."

    sim.printer.operator_loads_filament(unit=0, slot=0, color="00FF00FF")
    resolved = await panel.command(printer_id, "error.resolve", {"errorId": error["errorId"], "action": "RESUME_PROBLEM_SOLVED"})
    await panel.wait_result(resolved, "accepted")
    await panel.wait_event("job.resumed", jobRef=job_ref)
    cleared = await panel.wait_event("error.cleared")
    assert cleared["data"] == {"errorId": error["errorId"], "clearedBy": "PANEL"}
    await panel.wait_event("job.finished", jobRef=job_ref)


async def test_failure_while_preparing_is_reported_as_before_start(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    await sim.operate("fail_next_prepare")
    job_ref, _ = await start(panel, printer_id, snapshot)

    failed = await panel.wait_event("job.failed", jobRef=job_ref)
    assert failed["data"]["beforeStart"] is True
    assert "Build plate not detected" in failed["data"]["reason"]
    assert not panel.events("job.started")


async def test_firmware_rejecting_the_start_fails_the_command_with_its_words(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    await sim.operate("reject_next_print", text="Nozzle type does not match the sliced file.")
    job_ref, command_id = await start(panel, printer_id, snapshot)

    result = await panel.wait_result(command_id, "failed")
    assert result["code"] == "start_rejected"
    assert result["message"] == "Nozzle type does not match the sliced file."
    await panel.wait_for(lambda: file_name(job_ref) not in sim.printer.files)
    assert sim.printer.state == "idle"


# 传文件


async def test_interrupted_upload_is_retried(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    await sim.operate("cut_next_upload")
    job_ref, command_id = await start(panel, printer_id, snapshot)

    await panel.wait_event("job.finished", jobRef=job_ref)
    attempts = panel.results(command_id)[-1]["data"]["attempts"]
    assert [attempt["step"] for attempt in attempts] == ["upload"]


async def test_download_that_keeps_failing_gives_up_without_touching_the_printer(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    panel.download_failures = 99
    job_ref, command_id = await start(panel, printer_id, snapshot)

    result = await panel.wait_result(command_id, "failed")
    assert result["code"] == "transfer_failed"
    assert len(result["data"]["attempts"]) == 4  # 第一次加三次重试
    assert sim.printer.files == {} and sim.printer.state == "idle"


async def test_corrupted_download_is_not_sent_to_the_printer(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    file = panel.add_file(CONTENT)
    file["sha256"] = "0" * 64
    _, command_id = await panel.start_job(printer_id, file, expected_run_seq=snapshot["runSeq"])

    result = await panel.wait_result(command_id, "failed")
    assert result["code"] == "transfer_failed"
    assert sim.printer.files == {}


# 开打前检查


async def test_start_is_refused_when_the_printer_ran_something_since_dispatch(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    # 派单之后有人在机器上打了别的东西，现在停在"已停止"，板子上可能有东西
    sim.printer.operator_starts_local_print()
    await panel.wait_event("external.started")
    await sim.operate("press_stop")
    ended = await panel.wait_event("external.ended")
    assert ended["data"] == {"result": "CANCELLED"}

    job_ref, command_id = await start(panel, printer_id, snapshot)
    result = await panel.wait_result(command_id, "rejected")
    assert result["code"] == "printer_used"
    await panel.wait_for(lambda: file_name(job_ref) not in sim.printer.files)
    assert sim.printer.state == "stopped"


async def test_start_is_refused_while_the_printer_is_running(panel, sim, harness):
    printer_id, _ = await connect(panel, sim, harness)
    sim.printer.config.print_seconds = 60
    sim.printer.operator_starts_local_print()
    running = await panel.wait_snapshot(printer_id, lambda item: item["state"] == "PREPARING")
    assert running["job"] == {**running["job"], "external": True, "name": "benchy.gcode.3mf"}

    _, command_id = await start(panel, printer_id, running)
    result = await panel.wait_result(command_id, "rejected")
    assert result["code"] == "printer_busy"


# 命令的过期和去重


async def test_expired_command_is_never_executed(panel, sim, harness):
    printer_id, _ = await connect(panel, sim, harness)
    command_id = await panel.command(printer_id, "control", {"action": "light.set", "args": {"on": False}}, expires_in=-5)
    await panel.wait_result(command_id, "expired")
    assert sim.printer.light is True


async def test_same_command_delivered_twice_runs_once(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    job_ref, command_id = await start(panel, printer_id, snapshot)
    # 面板没收到确认，把同一条命令又投了一遍（新的消息，同一个命令 ID）
    await panel.send("command", {
        "commandId": command_id, "printerId": printer_id, "kind": "job.start", "expiresAt": "2099-01-01T00:00:00Z",
        "params": {"jobRef": job_ref, "expectedRunSeq": snapshot["runSeq"], "file": panel.add_file(CONTENT), "plateIndex": 1, "bedType": "x", "mapping": [], "timelapse": False},
    })
    await panel.wait_event("job.finished", jobRef=job_ref)
    assert len(sim.printer.history) == 1


async def test_control_outside_the_model_list_is_rejected(panel, sim, harness):
    printer_id, _ = await connect(panel, sim, harness)
    command_id = await panel.command(printer_id, "control", {"action": "axis.home", "args": {}})
    result = await panel.wait_result(command_id, "rejected")
    assert result["code"] == "unsupported_control"

    light = await panel.command(printer_id, "control", {"action": "light.set", "args": {"on": False}})
    await panel.wait_result(light, "accepted")
    await panel.wait_snapshot(printer_id, lambda item: item.get("controls") == {"light": "off"})


async def test_storage_list_marks_which_files_are_ours(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    sim.printer.store_file("left-by-someone.gcode.3mf", 123)
    sim.printer.config.print_seconds = 60
    job_ref, _ = await start(panel, printer_id, snapshot)
    await panel.wait_event("job.staged", jobRef=job_ref)

    command_id = await panel.command(printer_id, "storage.list", {})
    result = await panel.wait_result(command_id, "done")
    files = {item["name"]: item["system"] for item in result["data"]["files"]}
    assert files == {"left-by-someone.gcode.3mf": False, file_name(job_ref): True}


# 断线和重启


async def test_events_are_resent_until_the_panel_acknowledges(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    job_ref, _ = await start(panel, printer_id, snapshot)
    await panel.wait_event("job.started", jobRef=job_ref)

    panel.acking = False  # 面板收不到了：之后的消息都没确认
    await panel.drop_connection()
    await panel.wait_for(lambda: panel.connections == 2, timeout=15)
    panel.acking = True
    await panel.drop_connection()
    await panel.wait_for(lambda: panel.connections == 3, timeout=15)

    await panel.wait_event("job.finished", jobRef=job_ref, timeout=15)
    assert len(panel.events("job.finished")) == 1


async def test_job_that_finishes_while_the_printer_is_unreachable(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    job_ref, _ = await start(panel, printer_id, snapshot)
    await panel.wait_event("job.started", jobRef=job_ref)

    await sim.unplug_network(2.5)
    down = await panel.wait_event("connection.down")
    offline = await panel.wait_snapshot(printer_id, lambda item: not item["connected"] and item["seq"] > down["seq"])
    assert offline["state"] == "OFFLINE"

    await panel.wait_event("job.finished", jobRef=job_ref, timeout=15)
    back = await panel.wait_snapshot(printer_id, lambda item: item["state"] == "FINISHED")
    # 断线期间打印机跑过东西（这次任务的后半段），运行序号要往前走
    assert back["runSeq"] > snapshot["runSeq"] + 1


async def test_quiet_network_gap_does_not_advance_the_run_counter(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    await sim.unplug_network(1.0)
    await panel.wait_event("connection.down")
    await panel.wait_for(lambda: len(panel.events("connection.up")) == 2, timeout=15)
    back = await panel.wait_snapshot(printer_id, lambda item: item["connected"] and item["seq"] > panel.events("connection.up")[-1]["seq"])
    # 打印机自己的任务记录能证明这段时间它没跑过东西
    assert back["runSeq"] == snapshot["runSeq"]


async def test_power_cycle_mid_print_is_left_for_people_to_judge(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    job_ref, _ = await start(panel, printer_id, snapshot)
    await panel.wait_event("job.started", jobRef=job_ref)

    await sim.operate("power_cycle", seconds=1.0)
    await panel.wait_for(lambda: len(panel.events("connection.up")) == 2, timeout=15)
    back = await panel.wait_snapshot(printer_id, lambda item: item["connected"] and item["state"] == "IDLE")
    assert back["deviceBoot"] != snapshot["deviceBoot"]
    await settle()
    # 任务没了，但打印机没说它是打完还是失败：daemon 不替它下结论
    assert not [event for event in panel.events() if event["kind"] in ("job.finished", "job.failed", "job.cancelled")]


async def test_daemon_killed_before_issuing_start_fails_the_command_cleanly(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    panel.download_delay = 5.0
    job_ref, command_id = await start(panel, printer_id, snapshot)
    await panel.wait_snapshot(printer_id, lambda item: item.get("pendingStarts"))

    await harness.kill()
    panel.download_delay = 0.0
    await harness.start()

    result = await panel.wait_result(command_id, "failed")
    assert result["code"] == "daemon_restarted"
    await settle(1.0)
    assert sim.printer.state == "idle" and sim.printer.history == []


async def test_daemon_killed_right_after_committing_to_start_does_not_send_it_again(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    daemon = harness.daemon

    def die(pipeline):
        raise asyncio.CancelledError  # 进程在"发起打印"落盘之后、发指令之前被杀

    daemon.before_start_command = die
    job_ref, command_id = await start(panel, printer_id, snapshot)
    await panel.wait_for(lambda: daemon.store.start_get(job_ref) is not None and daemon.store.start_get(job_ref).start_issued_at)
    await harness.kill()
    await harness.start()

    await settle(1.5)
    # 说不清指令发没发出去：不重发，也不替打印机下结论
    assert sim.printer.state == "idle" and sim.printer.history == []
    assert not [item for item in panel.results(command_id) if item["status"] in ("failed", "rejected")]
    assert not [event for event in panel.events() if event["kind"].startswith("job.") and event["kind"] != "job.staged"]
