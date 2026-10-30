// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import BackupRecovery, { type BackupState } from "./BackupRecovery";
import App from "../App";
const base: BackupState = {
  settings: {
    enabled: true,
    time: "02:00",
    timeZone: "America/New_York",
    daily: 7,
    weekly: 4,
    monthly: 3,
    restoreEveryDays: 7,
    externalDirectory: "",
    externalOverdueDays: 7,
    version: 0,
  },
  directory: "/synthetic/backups/managed",
  freeBytes: 1024 ** 3,
  lastSuccessfulBackup: "2026-10-30T10:00:00Z",
  nextScheduledBackup: "2026-10-31T06:00:00Z",
  missedBackup: false,
  busy: false,
  operation: { state: "idle" },
  backups: [
    {
      id: "bkp-synthetic",
      createdAt: "2026-10-30T10:00:00Z",
      reason: "manual",
      verification: "archive_verified",
      verifiedAt: "2026-10-30T10:01:00Z",
      bytes: 1000,
      legacy: false,
      encrypted: false,
    },
  ],
  history: [],
  external: {
    directory: "",
    available: false,
    lastSuccessfulCopy: null,
    overdue: false,
  },
  liveRestoreAvailable: false,
  encrypted: false,
};
let state: BackupState, fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  state = structuredClone(base);
  for (const method of ["showModal", "close"])
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function () {
        if (method === "showModal") this.setAttribute("open", "");
        else this.removeAttribute("open");
      },
    });
  fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    if (path === "/api/backups/settings" && init?.method === "PUT") {
      state.settings = { ...JSON.parse(String(init.body)), version: 1 };
      return Response.json(state.settings);
    }
    if (init?.method === "POST")
      return Response.json({ accepted: true }, { status: 202 });
    if (path === "/api/backups") return Response.json(state);
    return new Response(JSON.stringify({ detail: "Database unavailable" }), {
      status: 503,
    });
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});
const setup = () => render(<BackupRecovery />);
it("shows backup status, archive verification and explicit encryption limits", async () => {
  setup();
  await screen.findByText("Backup history");
  expect(screen.getByText("archive verified")).toBeTruthy();
  expect(screen.getAllByText(/not encrypted/).length).toBeGreaterThan(0);
  expect(screen.getByText("/synthetic/backups/managed")).toBeTruthy();
});
it("starts manual backup asynchronously and displays acceptance", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Backup Now" }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/backups",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  expect(await screen.findByText(/Operation accepted/)).toBeTruthy();
});
it("shows progress and disables overlapping operations", async () => {
  state.busy = true;
  state.operation = { state: "running", stage: "Verifying checksums" };
  setup();
  expect(await screen.findByText(/Verifying checksums/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Backup Now" })).toHaveProperty(
    "disabled",
    true,
  );
});
it("requires explicit confirmation for an isolated restore and disables live replacement", async () => {
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Restore From Backup" }),
  );
  expect(
    screen.getByRole("button", { name: "Confirm isolated restore test" }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("button", { name: /Replace active database/ }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm isolated restore test" }),
  );
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/backups/bkp-synthetic/restore-test",
      expect.objectContaining({ body: JSON.stringify({ confirmed: true }) }),
    ),
  );
});
it("verifies the chosen backup identifier", async () => {
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Verify Backup" }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/backups/bkp-synthetic/verify",
      expect.objectContaining({ method: "POST" }),
    ),
  );
});
it("saves daily schedule and retention only explicitly", async () => {
  setup();
  await screen.findByLabelText("Daily backup time");
  fireEvent.change(screen.getByLabelText("Daily backup time"), {
    target: { value: "04:15" },
  });
  expect(fetcher.mock.calls.every(([, i]) => !i?.method)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save backup settings" }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/backups/settings",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"time":"04:15"'),
      }),
    ),
  );
});
it("does not overwrite a schedule draft during status polling", async () => {
  setup();
  await screen.findByLabelText("Daily backup time");
  fireEvent.change(screen.getByLabelText("Daily backup time"), {
    target: { value: "05:30" },
  });
  await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(1), {
    timeout: 3500,
  });
  expect(screen.getByLabelText("Daily backup time")).toHaveProperty(
    "value",
    "05:30",
  );
});
it("handles a disconnected drive without disabling local backup", async () => {
  state.external = {
    directory: "/Volumes/Absent/Backups",
    available: false,
    lastSuccessfulCopy: null,
    overdue: true,
  };
  setup();
  await screen.findByText(/External backups are overdue/);
  expect(screen.getByRole("button", { name: "Backup Now" })).toHaveProperty(
    "disabled",
    false,
  );
  expect(
    screen.getByRole("button", {
      name: "Copy verified backups to external drive",
    }),
  ).toHaveProperty("disabled", true);
});
it("exports JSON and presents the prepared download", async () => {
  state.operation = {
    state: "succeeded",
    result: { exportId: "export-synthetic.json" },
  };
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Export JSON" }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/backups/exports",
      expect.objectContaining({ body: '{"format":"json"}' }),
    ),
  );
  expect(
    screen
      .getByRole("link", { name: "Download prepared export" })
      .getAttribute("href"),
  ).toBe("/api/backups/exports/export-synthetic.json");
});
it("shows backup failures and retries status", async () => {
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ detail: "Tools unavailable" }), {
      status: 503,
    }),
  );
  setup();
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Tools unavailable"),
  );
  fireEvent.click(screen.getByText("Refresh backup status"));
  await screen.findByRole("button", { name: "Backup Now" });
});
it("keeps Settings available when financial database reads fail", async () => {
  window.location.hash = "#settings";
  render(<App />);
  expect(
    await screen.findByRole("button", { name: "Backup Now" }),
  ).toBeTruthy();
  expect(screen.queryByText("We couldn’t load your finances")).toBeNull();
});

it("keeps a prepared export available after a scheduled no-op replaces operation status", async () => {
  state.operation = { state: "succeeded" };
  state.lastExport = { exportId: "export-prepared.json" };
  setup();
  expect(
    (
      await screen.findByRole("link", { name: "Download prepared export" })
    ).getAttribute("href"),
  ).toBe("/api/backups/exports/export-prepared.json");
});
