"""主流程：真 daemon + 模拟打印机 + 假面板。"""

from __future__ import annotations

from platerelay_daemon.printers import file_name

CONTENT = b"fake 3mf content " * 4096


async def connect(panel, sim, harness):
    printer_id = panel.add_printer(sim.address, sim.printer.config.serial)
    await harness.start()
    snapshot = await panel.wait_snapshot(printer_id, lambda item: item["connected"])
    return printer_id, snapshot


async def test_snapshot_reports_the_printer_in_standard_terms(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    assert snapshot["state"] == "IDLE"
    assert snapshot["runSeq"] == 0
    assert [nozzle["extruder"] for nozzle in snapshot["nozzles"]] == [1, 2]
    loaded = [tray for tray in snapshot["trays"] if "material" in tray]
    assert loaded[0] == {
        "unit": 0, "slot": 0, "label": "AMS 1 · 1", "material": "PLA", "subType": "PLA Basic",
        "colour": "#FFFFFF", "rfidUid": "A1B2C3D400000001", "remainingPercent": 80, "extruders": [1],
    }
    assert await panel.wait_event("connection.up", printerId=printer_id)


async def test_job_runs_from_start_command_to_finished(panel, sim, harness):
    printer_id, snapshot = await connect(panel, sim, harness)
    job_ref, command_id = await panel.start_job(printer_id, panel.add_file(CONTENT), expected_run_seq=snapshot["runSeq"])

    await panel.wait_event("job.staged", jobRef=job_ref)
    steps = [result["data"]["step"] for result in panel.results(command_id) if result["status"] == "accepted"]
    assert steps == ["queued", "download", "upload"]

    preparing = await panel.wait_snapshot(printer_id, lambda item: item["state"] == "PREPARING")
    assert preparing["job"]["jobRef"] == job_ref and preparing["job"]["external"] is False
    assert preparing["substage"] is not None

    await panel.wait_event("job.started", jobRef=job_ref)
    await panel.wait_event("job.finished", jobRef=job_ref)
    finished = await panel.wait_snapshot(printer_id, lambda item: item["state"] == "FINISHED")
    assert finished["runSeq"] == snapshot["runSeq"] + 1
    assert finished["job"]["percent"] == 100

    # 打完后 daemon 删掉自己放上去的文件
    await panel.wait_for(lambda: file_name(job_ref) not in sim.printer.files)
    order = [event["kind"] for event in panel.events() if event.get("jobRef") == job_ref]
    assert order == ["job.staged", "job.started", "job.finished"]
