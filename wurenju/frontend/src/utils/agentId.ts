const CHINESE_PINYIN_MAP: Record<string, string> = {
  阿: "a",
  艾: "ai",
  安: "an",
  白: "bai",
  包: "bao",
  北: "bei",
  冰: "bing",
  波: "bo",
  博: "bo",
  才: "cai",
  昌: "chang",
  超: "chao",
  陈: "chen",
  晨: "chen",
  成: "cheng",
  程: "cheng",
  池: "chi",
  楚: "chu",
  春: "chun",
  大: "da",
  丹: "dan",
  德: "de",
  邓: "deng",
  董: "dong",
  东: "dong",
  发: "fa",
  飞: "fei",
  芬: "fen",
  峰: "feng",
  冯: "feng",
  福: "fu",
  高: "gao",
  工: "gong",
  官: "guan",
  国: "guo",
  海: "hai",
  韩: "han",
  浩: "hao",
  何: "he",
  和: "he",
  红: "hong",
  华: "hua",
  黄: "huang",
  慧: "hui",
  霍: "huo",
  佳: "jia",
  嘉: "jia",
  建: "jian",
  监: "jian",
  江: "jiang",
  杰: "jie",
  经: "jing",
  静: "jing",
  军: "jun",
  凯: "kai",
  咖: "ka",
  康: "kang",
  可: "ke",
  兰: "lan",
  老: "lao",
  雷: "lei",
  李: "li",
  丽: "li",
  理: "li",
  力: "li",
  连: "lian",
  良: "liang",
  林: "lin",
  玲: "ling",
  刘: "liu",
  伦: "lun",
  罗: "luo",
  马: "ma",
  曼: "man",
  美: "mei",
  明: "ming",
  娜: "na",
  宁: "ning",
  欧: "ou",
  鹏: "peng",
  品: "pin",
  平: "ping",
  强: "qiang",
  前: "qian",
  琴: "qin",
  青: "qing",
  秋: "qiu",
  权: "quan",
  然: "ran",
  瑞: "rui",
  三: "san",
  珊: "shan",
  师: "shi",
  诗: "shi",
  石: "shi",
  时: "shi",
  收: "shou",
  宋: "song",
  苏: "su",
  孙: "sun",
  台: "tai",
  涛: "tao",
  天: "tian",
  王: "wang",
  伟: "wei",
  文: "wen",
  吴: "wu",
  西: "xi",
  先: "xian",
  贤: "xian",
  祥: "xiang",
  项: "xiang",
  萧: "xiao",
  晓: "xiao",
  小: "xiao",
  欣: "xin",
  星: "xing",
  秀: "xiu",
  许: "xu",
  雅: "ya",
  严: "yan",
  验: "yan",
  杨: "yang",
  瑶: "yao",
  叶: "ye",
  一: "yi",
  义: "yi",
  毅: "yi",
  英: "ying",
  营: "ying",
  勇: "yong",
  友: "you",
  优: "you",
  宇: "yu",
  元: "yuan",
  员: "yuan",
  云: "yun",
  增: "zeng",
  张: "zhang",
  赵: "zhao",
  哲: "zhe",
  真: "zhen",
  志: "zhi",
  智: "zhi",
  中: "zhong",
  周: "zhou",
  朱: "zhu",
  助: "zhu",
  子: "zi",
  总: "zong",
  策: "ce",
  测: "ce",
  产: "chan",
  长: "zhang",
  创: "chuang",
  端: "duan",
  调: "diao",
  付: "fu",
  后: "hou",
  化: "hua",
  交: "jiao",
  计: "ji",
  开: "kai",
  略: "lue",
  流: "liu",
  目: "mu",
  群: "qun",
  设: "she",
  试: "shi",
  体: "ti",
  询: "xun",
  协: "xie",
  销: "xiao",
  研: "yan",
  运: "yun",
  咨: "zi",
  做: "zuo",
};

const SEPARATOR_RE = /[\s_-]+/;
const ASCII_RE = /[a-z0-9]/;
const CJK_RE = /[\u3400-\u9fff]/;

function normalizeIdParts(parts: string[]) {
  return parts
    .join("-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function transliterateChineseChar(char: string) {
  const mapped = CHINESE_PINYIN_MAP[char];
  if (mapped) {
    return mapped;
  }

  // 轻量兜底：极少数字库没覆盖的汉字，退回 Unicode 码点，至少保证可定位。
  const codePoint = char.codePointAt(0);
  return codePoint ? `u${codePoint.toString(16)}` : "";
}

function buildReadableAgentId(displayName: string) {
  const parts: string[] = [];
  let asciiBuffer = "";

  const flushAsciiBuffer = () => {
    if (!asciiBuffer) {
      return;
    }
    parts.push(asciiBuffer.toLowerCase());
    asciiBuffer = "";
  };

  for (const char of Array.from(displayName.trim())) {
    if (ASCII_RE.test(char.toLowerCase())) {
      asciiBuffer += char.toLowerCase();
      continue;
    }

    if (SEPARATOR_RE.test(char)) {
      flushAsciiBuffer();
      parts.push("-");
      continue;
    }

    flushAsciiBuffer();

    if (CJK_RE.test(char)) {
      parts.push(transliterateChineseChar(char));
      continue;
    }

    parts.push("-");
  }

  flushAsciiBuffer();
  const normalized = normalizeIdParts(parts);
  return normalized || "agent";
}

function appendNumericSuffix(baseId: string, suffix: number) {
  const suffixText = `-${suffix}`;
  const maxBaseLength = Math.max(1, 64 - suffixText.length);
  return `${baseId.slice(0, maxBaseLength)}${suffixText}`;
}

export function buildAvailableAgentId(displayName: string, existingIds: Iterable<string>) {
  const reservedIds = new Set(Array.from(existingIds, (id) => id.trim().toLowerCase()));
  let baseId = buildReadableAgentId(displayName);

  if (!baseId || baseId === "main") {
    baseId = `agent-${Date.now().toString(36)}`;
  }

  let candidate = baseId;
  let suffix = 2;
  while (reservedIds.has(candidate)) {
    candidate = appendNumericSuffix(baseId, suffix);
    suffix += 1;
  }

  return candidate;
}
