// Base44 SDK versions have returned custom-function payloads in two shapes:
// either as the payload itself, or wrapped in an Axios-style `{ data }` object.
// Keep the compatibility boundary here so room code always consumes the
// server's actual JSON payload and never has to guess at the SDK transport.
const isRecord = (value) => !!value && typeof value === "object" && !Array.isArray(value);

export function normalizeFunctionResponse(response) {
  if (!isRecord(response)) return {};
  return isRecord(response.data) ? response.data : response;
}

// The current SDK throws Base44Error with `status` and `data`; older Axios
// callers/tests may still expose the error under `response.status/data`.
export function functionErrorData(error) {
  if (!isRecord(error)) return {};
  if (isRecord(error.data)) return normalizeFunctionResponse(error.data);
  if (isRecord(error.response)) return normalizeFunctionResponse(error.response);
  return {};
}

export function functionErrorCode(error) {
  const code = functionErrorData(error).error;
  return typeof code === "string" ? code : "";
}

export function functionErrorStatus(error) {
  const value = error?.status ?? error?.response?.status;
  const status = Number(value);
  return Number.isFinite(status) && status > 0 ? status : null;
}
