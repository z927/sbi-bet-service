import { GoogleAuth } from "google-auth-library";
import { getSettings, type Settings } from "../config.ts";
import { FeedError } from "../scraper/client/transport.ts";

const API_BASE = "https://cloudscheduler.googleapis.com/v1";
const AUTH_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];
const TIMEOUT_MS = 15000;

export interface HttpTargetInput {
  httpMethod: string;
  uri: string;
  headers?: Record<string, string>;
  /** Base64-encoded body (Cloud Scheduler serializes bytes fields as base64). */
  body?: string;
}

export interface JobScheduleInput {
  schedule: string;
  timeZone: string;
  httpTarget: HttpTargetInput;
}

export interface SchedulerJob {
  name: string;
  schedule: string;
  timeZone?: string;
  httpTarget?: {
    uri?: string;
    httpMethod?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

export interface SchedulerClient {
  getJob(jobId: string): Promise<SchedulerJob | null>;
  createJob(input: JobScheduleInput): Promise<SchedulerJob>;
  updateJob(jobId: string, input: JobScheduleInput): Promise<SchedulerJob>;
  deleteJob(jobId: string): Promise<void>;
}

let googleAuth: GoogleAuth | null = null;

const accessToken = async (): Promise<string> => {
  googleAuth ??= new GoogleAuth({ scopes: AUTH_SCOPES });
  const client = await googleAuth.getClient();
  const result = await client.getAccessToken();
  const token =
    typeof result === "string"
      ? result
      : result !== null && typeof result === "object" && "token" in result
        ? (result as { token: string | null }).token
        : null;
  if (!token) {
    throw new FeedError("Cloud Scheduler: unable to obtain an ADC access token");
  }
  return token;
}

interface HttpResult {
  status: number;
  text: string;
}

export const createSchedulerClient = (settings: Settings = getSettings()): SchedulerClient => {
  const base = `${API_BASE}/projects/${settings.gcpProjectId}/locations/${settings.gcpRegion}/jobs`;

  const call = async (method: string, url: string, body?: unknown): Promise<HttpResult> => {
    const token = await accessToken();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : String(exc);
      throw new FeedError(`Cloud Scheduler ${method} request failed: ${message}`);
    }
    const text = await response.text();
    if (!response.ok && response.status !== 404) {
      throw new FeedError(`Cloud Scheduler ${method} returned HTTP ${response.status}: ${text.slice(0, 120)}`);
    }
    return { status: response.status, text };
  };

  const toJobResource = (input: JobScheduleInput): Record<string, unknown> => {
    return {
      schedule: input.schedule,
      timeZone: input.timeZone,
      httpTarget: {
        httpMethod: input.httpTarget.httpMethod,
        uri: input.httpTarget.uri,
        ...(input.httpTarget.headers ? { headers: input.httpTarget.headers } : {}),
        ...(input.httpTarget.body ? { body: input.httpTarget.body } : {}),
      },
    };
  };

  return {
    async getJob(jobId: string): Promise<SchedulerJob | null> {
      const { status, text } = await call("GET", `${base}/${jobId}`);
      if (status === 404) {
        return null;
      }
      return JSON.parse(text) as SchedulerJob;
    },

    async createJob(input: JobScheduleInput): Promise<SchedulerJob> {
      const { text } = await call("POST", base, toJobResource(input));
      return JSON.parse(text) as SchedulerJob;
    },

    async updateJob(jobId: string, input: JobScheduleInput): Promise<SchedulerJob> {
      const url = `${base}/${jobId}?updateMask=schedule,timeZone,httpTarget`;
      const { text } = await call("PATCH", url, { name: `${base}/${jobId}`, ...toJobResource(input) });
      return JSON.parse(text) as SchedulerJob;
    },

    async deleteJob(jobId: string): Promise<void> {
      await call("DELETE", `${base}/${jobId}`);
    },
  };
}

export const defaultSchedulerClient = (): SchedulerClient => {
  return createSchedulerClient(getSettings());
}
