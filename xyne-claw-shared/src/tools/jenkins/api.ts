/**
 * Jenkins API client for xyne-claw tools.
 * Uses Basic Auth with username:apiToken.
 */

interface JenkinsBuild {
  id: string;
  number: number;
  url: string;
  result: string | null;
  building: boolean;
  duration: number;
  estimatedDuration: number;
  timestamp: number;
  displayName: string;
  description: string | null;
}

interface JenkinsStage {
  id: string;
  name: string;
  status: "SUCCESS" | "FAILED" | "IN_PROGRESS" | "NOT_EXECUTED" | "ABORTED" | "PAUSED_PENDING_INPUT";
  startTimeMillis: number;
  durationMillis: number;
  pauseDurationMillis: number;
}

interface JenkinsWfApiResponse {
  id: string;
  name: string;
  status: string;
  startTimeMillis: number;
  endTimeMillis: number;
  durationMillis: number;
  queueDurationMillis: number;
  pauseDurationMillis: number;
  stages: JenkinsStage[];
}

interface JenkinsBuildInfo {
  id: string;
  number: number;
  result: string | null;
  building: boolean;
  url: string;
  timestamp: number;
}

interface ApiConfig {
  baseUrl: string;
  jobPath: string;
  username: string;
  apiToken: string;
}

function getAuthHeader(username: string, apiToken: string): string {
  return "Basic " + Buffer.from(`${username}:${apiToken}`).toString("base64");
}

async function getCrumb(config: ApiConfig): Promise<{ crumb: string; crumbField: string } | null> {
  try {
    const response = await fetch(`${config.baseUrl}/crumbIssuer/api/json`, {
      headers: {
        Authorization: getAuthHeader(config.username, config.apiToken),
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { crumb: string; crumbRequestField: string };
    return { crumb: data.crumb, crumbField: data.crumbRequestField };
  } catch {
    return null;
  }
}

export async function triggerBuild(
  config: ApiConfig,
  branch: string,
  parameters?: Record<string, string>,
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const crumb = await getCrumb(config);
    let url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/buildWithParameters?delay=0`;
    
    if (parameters && Object.keys(parameters).length > 0) {
      const params = new URLSearchParams(parameters);
      url += "&" + params.toString();
    }

    const headers: Record<string, string> = {
      Authorization: getAuthHeader(config.username, config.apiToken),
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (crumb) headers[crumb.crumbField] = crumb.crumb;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: "json={}",
      redirect: "manual",
    });

    if (response.status >= 200 && response.status < 400) {
      return { success: true, message: "Build triggered successfully" };
    }
    return { success: false, error: `Jenkins returned ${response.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[jenkins] triggerBuild failed:", msg);
    return { success: false, error: msg };
  }
}

export async function getLatestBuild(
  config: ApiConfig,
  branch: string,
): Promise<JenkinsBuild | null> {
  try {
    const url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/lastBuild/api/json`;
    const response = await fetch(url, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return null;
    return (await response.json()) as JenkinsBuild;
  } catch (err) {
    console.error("[jenkins] getLatestBuild failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function getBuildByNumber(
  config: ApiConfig,
  branch: string,
  buildNumber: number,
): Promise<JenkinsBuild | null> {
  try {
    const url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/${buildNumber}/api/json`;
    const response = await fetch(url, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return null;
    return (await response.json()) as JenkinsBuild;
  } catch (err) {
    console.error("[jenkins] getBuildByNumber failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function getBuildStages(
  config: ApiConfig,
  branch: string,
  buildNumber: number,
): Promise<JenkinsStage[]> {
  try {
    const url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/${buildNumber}/wfapi/describe`;
    const response = await fetch(url, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as JenkinsWfApiResponse;
    return data.stages || [];
  } catch (err) {
    console.error("[jenkins] getBuildStages failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

export async function getBuildLogs(
  config: ApiConfig,
  branch: string,
  buildNumber: number,
  stageName?: string,
): Promise<string> {
  try {
    let url: string;
    if (stageName) {
      url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/${buildNumber}/execution/node/${stageName}/wfapi/log`;
    } else {
      url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/${buildNumber}/consoleText`;
    }
    const response = await fetch(url, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return "";
    return await response.text();
  } catch (err) {
    console.error("[jenkins] getBuildLogs failed:", err instanceof Error ? err.message : String(err));
    return "";
  }
}

export async function listBuilds(
  config: ApiConfig,
  branch: string,
  limit: number = 10,
): Promise<JenkinsBuildInfo[]> {
  try {
    const url = `${config.baseUrl}${config.jobPath}/job/${encodeURIComponent(branch)}/api/json?tree=builds[id,number,result,building,url,timestamp]{0,${limit}}`;
    const response = await fetch(url, {
      headers: { Authorization: getAuthHeader(config.username, config.apiToken) },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { builds?: JenkinsBuildInfo[] };
    return data.builds || [];
  } catch (err) {
    console.error("[jenkins] listBuilds failed:", err instanceof Error ? err.message : String(err));
    return [];
  }
}

export type { JenkinsBuild, JenkinsStage, JenkinsBuildInfo, ApiConfig };
