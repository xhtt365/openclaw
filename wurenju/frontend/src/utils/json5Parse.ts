import JSON5 from "json5";

function locateJsonError(source: string, position: number) {
  let line = 1;
  let column = 1;

  for (let index = 0; index < position && index < source.length; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }
    column += 1;
  }

  return { line, column };
}

function buildParseErrorMessage(source: string, error: unknown) {
  const rawMessage =
    error instanceof Error && error.message.trim() ? error.message.trim() : "未知解析错误";

  const lineColumnMatch = rawMessage.match(/line\s+(\d+)\s+column\s+(\d+)/iu);
  if (lineColumnMatch) {
    const line = Number(lineColumnMatch[1]);
    const column = Number(lineColumnMatch[2]);
    return `JSON 格式有误，请检查（第 ${line} 行第 ${column} 列）`;
  }

  const positionMatch = rawMessage.match(/position\s+(\d+)/iu);
  if (positionMatch) {
    const position = Number(positionMatch[1]);
    const { line, column } = locateJsonError(source, position);
    return `JSON 格式有误，请检查（第 ${line} 行第 ${column} 列）`;
  }

  return "JSON 格式有误，请检查";
}

export function parseJSONWithComments<T = unknown>(str: string): T {
  const normalized = str.replace(/\r\n/g, "\n");

  try {
    return JSON5.parse(normalized);
  } catch (error) {
    throw new Error(buildParseErrorMessage(normalized, error), { cause: error });
  }
}

export function formatJSONWithComments(str: string) {
  return JSON.stringify(parseJSONWithComments(str), null, 2);
}
