import fs from "node:fs";

const APP_VERSION = "ver 2.5";
const MAX_TOTAL_NEWS = 144;
const MAX_NEWS_AGE_MS = 36 * 60 * 60 * 1000;
const BREAKING_WINDOW_MS = 8 * 60 * 60 * 1000;

const BLACKLIST_KEYWORDS = [
  "大公報", "大公網", "文匯報", "文匯網", "TVB", "無綫新聞", "無線新聞",
  "點新聞", "星島", "巴士的報", "港人講地", "橙新聞", "HKG報", "東方日報", "東網", "on.cc",
  "中天", "TVBS", "中時", "中國時報", "旺報", "聯合報", "聯合新聞網",
  "新華社", "人民日報", "環球時報", "央視", "觀察者網", "中新社", "中國新聞網"
];

const VIDEO_ONLY_PROGRAMS = [
  "科腦噏", "財經DNA", "窩輪攻略", "一期一匯", "大行報告", "講清講楚", "有理有得傾",
  "【重溫】", "[重溫]", "新聞天地", "千禧年代", "自由風自由Phone", "星期六問責", "講東講西",
  "每日樓市", "灣區快拍", "樓盤傳真", "衍生財智", "財智", "一線搜查", "小事大意義",
  "至FIT男女", "看神州", "神州進擊", "日日有樓睇", "周末樓市", "有線財經", "賽事精華",
  "自由說新聞", "自由追新聞", "新聞360", "官我什麼事",
  "我愛你之後", "戀愛1/2", "｜節目", "| 節目", "903 AllStar", "AllStar 籃球賽",
  "PURDORI呈獻", "足本版上線", "校園熱身賽", "節目重溫", "叱咤樂壇", "雷霆881", "剩返痛先感受到自己"
];

const BREAKING_VIP_KEYWORDS = [
  "突發", "快訊", "最新", "不斷更新", "急症", "送院", "昏迷", "墮樓", "墮海", "墮下",
  "三級火", "四級火", "五級火", "大火", "火警", "火災", "爆炸", "爆水管", "救援", "消防", "車禍",
  "相撞", "翻側", "天文台", "風球", "黑雨", "紅雨", "警告", "地震", "海嘯", "襲擊",
  "身亡", "不治", "斃命", "槍擊", "空難", "裁定", "判囚", "罪成", "施政報告", "預算案",
  "停課", "停工", "港鐵故障", "全線停駛", "延誤"
];

const HIGH_ALERT_BREAKING_REGEX = /(^突發|^【突發】|^快訊|^【快訊】|突發[｜|:：！!\s]|快訊[｜|:：！!\s]|三級火|四級火|五級火|黑雨|黑色暴雨|紅雨|紅色暴雨|八號烈風|八號風球|九號烈風|九號風球|十號颶風|十號風球|極端情況|大地震|海嘯警報|恐襲|恐怖襲擊|空難|墜機|槍擊案|嚴重車禍|連環相撞|全線停駛|港鐵故障|宣佈停課|宣布停課|戒嚴|宣戰|導彈襲擊|空襲|遇刺|爆炸案|大樓倒塌|塌樓|墮海|沉船)/i;

function getHkParts(ts) {
  const d = new Date(ts + 8 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, "0");
  return {
    y: d.getUTCFullYear(),
    m: pad(d.getUTCMonth() + 1),
    day: pad(d.getUTCDate()),
    h: pad(d.getUTCHours()),
    min: pad(d.getUTCMinutes()),
    s: pad(d.getUTCSeconds())
  };
}

function formatHkShort(ts) {
  const p = getHkParts(ts);
  return `${p.m}/${p.day} ${p.h}:${p.min}`;
}

function formatHkFull(ts) {
  const p = getHkParts(ts);
  return `${p.y}-${p.m}-${p.day} ${p.h}:${p.min}:${p.s}`;
}

async function safeFetch(url, options = {}, timeoutMs = 12000) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      ...options
    });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { status: 0, text: "" };
  }
}

async function fetchBatch(requests, concurrency = 10, timeoutMs = 12000) {
  const results = new Array(requests.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < requests.length) {
      const i = nextIdx++;
      const req = requests[i];
      results[i] = await safeFetch(req.url, {
        method: req.method || "GET",
        headers: req.headers || {},
        body: req.body
      }, timeoutMs);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, requests.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function loadPreviousNews() {
  try {
    if (fs.existsSync("prev_news.json")) {
      const raw = fs.readFileSync("prev_news.json", "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.items)) return parsed;
    }
  } catch (e) {}
  return null;
}

function hasEnoughChinese(title, body) {
  const t = (title || "").trim();
  const chineseCharsInTitle = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (chineseCharsInTitle < 3) return false;

  if (body && body.trim().length > 0) {
    const b = body.trim();
    const chineseCharsInBody = (b.match(/[\u4e00-\u9fa5]/g) || []).length;
    if (chineseCharsInBody < 6) return false;
    if (/^(?:\d+\s*\/\s*\d+\s+)?[A-Z\s,]{3,}\((?:AP|Reuters|AFP)\)/i.test(b)) return false;
  }
  return true;
}

function isSportsContent(title, body) {
  const t = (title || "").trim();
  const lead = (body || "").slice(0, 160).trim();
  const combined = t + " " + lead;

  const sportsEventRegex = /(葡超|美職|亞冠|荷甲|日職|韓職|沙特聯|港超|蘇超|土超|巴甲|阿甲|英超|西甲|意甲|德甲|法甲|歐聯|歐冠|歐霸|歐協聯|世界盃|亞洲盃|歐國盃|歐國聯|NBA|CBA|F1|MLB|NFL|WTA|ATP|網球|羽毛球|桌球|排球|手球|乒乓|劍擊|高爾夫|馬拉松|亞冠精英聯賽|足球聯賽|籃球聯賽|職棒|大滿貫|錦標賽|冠軍賽|公開賽|大師賽|大獎賽|巡迴賽|挑戰賽|世錦賽|亞錦賽|奧運|亞運|全運會|男單|女單|男雙|女雙|混雙|傳射建功|梅開二度|帽子戲法)/i;
  if (sportsEventRegex.test(t)) return true;

  const matchScoreRegex = /\d{1,2}\s*比\s*\d{1,2}/;
  const matchActionRegex = /(主場|作客|小勝|大勝|險勝|反勝|擊敗|不敵|言和|迫和|連勝|連敗|榜首|晉級|出線|出局|首圈|次圈|十六強|八強|四強|準決賽|決賽|先輸|先贏|直落|局數|球|聯賽|盃)/;
  if (matchScoreRegex.test(combined) && matchActionRegex.test(combined)) return true;

  if (/(首圈|次圈|八強|四強|準決賽|決賽)/.test(t) && /(出局|晉級|奪冠|衛冕|擊敗|不敵|負|勝)/.test(t)) {
    return true;
  }
  return false;
}

function markBreakingNewsItems(items, nowMs) {
  items.forEach(item => {
    item.isBreaking = false;
    if (!item.timestamp || (nowMs - item.timestamp) > BREAKING_WINDOW_MS) return;
    if (item.category === "娛樂" || item.category === "體育") return;
    if (isSportsContent(item.title, item.body)) return;

    const t = (item.title || "").trim();
    if (/(參議員|眾議員|中期選舉|州長選舉|縣長|市長選舉|補選|民調|得票)/.test(t) && !/(遇刺|槍擊|爆炸|戒嚴|暴動)/.test(t)) {
      return;
    }

    const hasHighAlertKeyword = HIGH_ALERT_BREAKING_REGEX.test(t);
    const isMajorEmergencyCluster = (item.clusterCount || 1) >= 3 && /(大火|火警|爆炸|地震|海嘯|風球|黑雨|紅雨|槍擊|空難|墜機|恐襲|死傷|身亡|不治|斃命|塌樓|墮海|沉船|停課|全線停駛|戒嚴|空襲|導彈)/.test(t);

    if (hasHighAlertKeyword || isMajorEmergencyCluster) {
      item.isBreaking = true;
    }
  });
}

function smartCorrectCategory(defaultCat, title, body, xmlCategoryText, sourceName) {
  const t = (title || "").trim();
  const lead = (body || "").slice(0, 180).trim();
  const combined = t + " " + lead;
  const xmlCat = (xmlCategoryText || "").trim();

  let cat = defaultCat;

  if (xmlCat) {
    if (/(體育|足球|籃球|運動)/.test(xmlCat)) cat = "體育";
    else if (/(娛樂|Showbiz|星蹤)/.test(xmlCat)) cat = "娛樂";
    else if (/(國際|世界|環球)/.test(xmlCat)) cat = "國際";
    else if (/(中國|兩岸|台灣|澳門|大中華)/.test(xmlCat)) cat = "兩岸";
    else if (/(港聞|本地|社會|政情|財經|地產|經濟)/.test(xmlCat)) cat = "港聞";
  }

  if (isSportsContent(t, lead)) return "體育";

  const hasMacauMention = /(澳門|司警|治安警|新口岸|路氹|氹仔|濠江|拱北|橫琴)/.test(combined);
  const hasHkMention = /(香港|本港|港人|港府|港隊|港股|恒指|留港|訪港|抵港|在港|中環|旺角|尖沙咀|銅鑼灣|沙田|荃灣|元朗|屯門|將軍澳|九龍|新界|港島|港鐵|天文台|李家超)/.test(combined);
  const hasTwCnMention = hasMacauMention || /(台灣|台北|新北|台中|台南|高雄|桃園|澎湖|花蓮|新竹|基隆|賴清德|蔣萬安|民進黨|國民黨|民眾黨|立法院|陸委會|台海|兩岸|中國|中共|北京|上海|廣東|深圳|廣州|習近平|國台辦|中國外交部|台外交部|王毅|毛寧|林劍|解放軍|大陸|內地)/.test(combined);
  const strongIntlRegex = /(土耳其|埃爾多安|伊斯坦堡|伊茲密爾|安卡拉|俄烏戰爭|烏克蘭|俄羅斯|莫斯科|普京|澤連斯基|梅拉尼婭|特朗普|川普|拜登|魯比奧|馬斯克|白宮|五角大樓|美國|密西西比|華盛頓|紐約|加州|佛羅里達|英國|倫敦|施紀賢|法國|巴黎|馬克龍|德國|柏林|法蘭克福|西班牙|馬德里|意大利|羅馬|梵蒂岡|教宗|瑞士|日內瓦|荷蘭|比利時|布魯塞爾|奧地利|維也納|希臘|葡萄牙|捷克|匈牙利|丹麥|愛爾蘭|芬蘭|挪威|瑞典|波蘭|歐洲|歐盟|北約|東盟|菲律賓|馬尼拉|宿霧|印尼|雅加達|馬來西亞|吉隆坡|新加坡|泰國|曼谷|越南|河內|緬甸|柬埔寨|老撾|日本|東京|大阪|北海道|石破茂|高市早苗|南韓|韓國|首爾|仁川|釜山|梨泰院|李在明|尹錫悅|北韓|平壤|金正恩|以色列|內塔尼亞胡|加沙|巴勒斯坦|哈馬斯|伊朗|德黑蘭|哈梅內伊|伊拉克|敘利亞|黎巴嫩|約旦|也門|沙特|沙地|阿聯酋|杜拜|阿布扎比|卡塔爾|阿富汗|巴基斯坦|孟加拉|尼泊爾|斯里蘭卡|印度|新德里|莫迪|中東|埃及|開羅|南非|摩洛哥|肯雅|澳洲|悉尼|墨爾本|紐西蘭|新西蘭|加拿大|溫哥華|多倫多|巴西|阿根廷|墨西哥|智利|秘魯|哥倫比亞|委內瑞拉|古巴|巴拿馬|聯合國|世衛|七國集團|二十國集團|國際油價)/;

  if (hasMacauMention && !hasHkMention) return "兩岸";

  if (cat === "體育") {
    const crimeOrSocietyNoise = /(流鶯|春宵|肉金|賣淫|掃黃|誣衊|誣告|偷錢|盜竊|行劫|搶劫|騙案|詐騙|謀殺|命案|屍體|墮樓|燒炭|車禍|火警|三級火|司警|治安警|檢察院|廉署|賄選|交保)/.test(combined);
    const anySportsKeyword = /(球|賽|隊|運動|奧運|亞運|全運|田徑|游泳|劍擊|張家朗|何詩蓓|體壇|馬拉松|F1|賽車|車手|拳擊|體操|金牌|銀牌|銅牌|獎牌|主場|作客|晉級|出局|奪冠|連勝|連敗|教練|球員|球星|職棒|大聯盟|MLB|NBA|英超|西甲|意甲|德甲|法甲|葡超|美職|亞冠|歐冠|歐聯|歐霸|世界盃|亞洲盃|阿甲|單車|滑浪|武術|柔道|跆拳道|高爾夫|男單|女單|男雙|女雙|混雙)/i.test(combined);

    if (crimeOrSocietyNoise || !anySportsKeyword) {
      if (hasTwCnMention && !hasHkMention) return "兩岸";
      if (strongIntlRegex.test(combined) && !hasHkMention) return "國際";
      return "港聞";
    }
  }

  const strongHkRegex = /(【港股|【新股|恒指|恒生指數|本港股市|港股|港交所|特首|李家超|陳國基|陳茂波|林定國|何永賢|政府總部|立法會|區議會|警務處|東九龍|西九龍|港鐵|天文台|醫管局|廉政公署|海關|入境處|環保署|房委會|公屋|居屋|紅隧|東隧|西隧|八號風球|黑雨)/;
  if (strongHkRegex.test(combined)) return "港聞";

  if (cat === "港聞" && !hasHkMention) {
    if (strongIntlRegex.test(combined) && !hasTwCnMention) return "國際";
    if (hasTwCnMention && !strongIntlRegex.test(combined)) return "兩岸";
    if (strongIntlRegex.test(combined)) return "國際";
  }

  if (cat === "兩岸" && !hasTwCnMention && !hasHkMention) {
    if (strongIntlRegex.test(combined)) return "國際";
  }

  return cat;
}

function normalizeDisplaySourceName(sourceName, finalCategory) {
  if (!sourceName) return "";
  if ((sourceName === "體壇及港隊" || sourceName === "足球焦點" || sourceName === "NBA 戰報") && finalCategory !== "體育") {
    return "香港01";
  }
  if ((sourceName === "韓星 K-Pop" || sourceName === "香港01娛樂") && finalCategory !== "娛樂") {
    return "香港01";
  }
  if (sourceName === "Now 國際" && finalCategory !== "國際") {
    return "Now 新聞";
  }
  if ((sourceName === "有線國際" && finalCategory !== "國際") || (sourceName === "有線兩岸" && finalCategory !== "兩岸")) {
    return "有線新聞";
  }
  return sourceName;
}

function getNewsSourcesConfig() {
  return [
    // 🇭🇰 港聞
    { category: "港聞", sourceName: "有線新聞", statGroup: "有線新聞", url: "https://www.i-cable.com/feed/", maxCount: 18, priority: 12 },
    { category: "港聞", sourceName: "Now 新聞", statGroup: "Now 新聞", url: "https://www.bing.com/news/search?q=site:news.now.com+%E9%A6%99%E6%B8%AF&setmkt=zh-HK&format=rss", maxCount: 10, priority: 12 },
    { category: "港聞", sourceName: "Now 新聞", statGroup: "Now 新聞", url: "https://news.google.com/rss/search?q=site:news.now.com+%E6%B8%AF%E8%81%9E+when:1d&hl=zh-HK&gl=HK&ceid=HK:zh-Hant", maxCount: 6, priority: 11 },
    { category: "港聞", sourceName: "香港01", statGroup: "香港01", url: "https://www.bing.com/news/search?q=site:hk01.com+(%E6%B8%AF%E8%81%9E+OR+%E7%AA%81%E7%99%BC+OR+%E7%A4%BE%E6%9C%83%E6%96%B0%E8%81%9E+OR+%E6%94%BF%E6%83%85)&setmkt=zh-HK&format=rss", maxCount: 12, priority: 12 },
    { category: "港聞", sourceName: "集誌社", statGroup: "集誌社", url: "https://thecollectivehk.com/feed/", maxCount: 6, priority: 11 },
    { category: "港聞", sourceName: "獨立媒體", statGroup: "獨立媒體", url: "https://www.inmediahk.net/rss.xml", maxCount: 6, priority: 11 },
    { category: "港聞", sourceName: "商業電台", statGroup: "商業電台", url: "https://www.bing.com/news/search?q=site:881903.com+%E6%B8%AF%E8%81%9E&setmkt=zh-HK&format=rss", maxCount: 6, priority: 10 },
    { category: "港聞", sourceName: "商業電台", statGroup: "商業電台", url: "https://www.bing.com/news/search?q=site:hk.news.yahoo.com+%E5%95%86%E5%8F%B0%E6%96%B0%E8%81%9E+%E9%A6%99%E6%B8%AF&setmkt=zh-HK&format=rss", maxCount: 6, priority: 10 },
    { category: "港聞", sourceName: "am730", statGroup: "am730", url: "https://www.bing.com/news/search?q=site:am730.com.hk+%E6%9C%AC%E5%9C%B0&setmkt=zh-HK&format=rss", maxCount: 6, priority: 9 },
    { category: "港聞", sourceName: "am730", statGroup: "am730", url: "https://news.google.com/rss/search?q=site:am730.com.hk+%E6%B8%AF%E8%81%9E+when:1d&hl=zh-HK&gl=HK&ceid=HK:zh-Hant", maxCount: 5, priority: 9 },
    { category: "港聞", sourceName: "RTHK本地", statGroup: "香港電台", url: "https://rthk.hk/rthk/news/rss/c_expressnews_clocal.xml", maxCount: 7, priority: 8 },

    // 🌍 國際
    { category: "國際", sourceName: "BBC News", statGroup: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml", maxCount: 10, priority: 13, needTranslate: true },
    { category: "國際", sourceName: "Reuters 路透社", statGroup: "路透社 Reuters", url: "https://news.google.com/rss/search?q=site:news.yahoo.com+Reuters+world+when:1d&hl=en-US&gl=US&ceid=US:en", maxCount: 6, priority: 13, needTranslate: true },
    { category: "國際", sourceName: "Reuters 路透社", statGroup: "路透社 Reuters", url: "https://www.bing.com/news/search?q=site:reuters.com+world&setmkt=en-US&format=rss", maxCount: 5, priority: 13, needTranslate: true },
    { category: "國際", sourceName: "Now 國際", statGroup: "Now 新聞", url: "https://www.bing.com/news/search?q=site:news.now.com+%E5%9C%8B%E9%9A%9B&setmkt=zh-HK&format=rss", maxCount: 6, priority: 10 },
    { category: "國際", sourceName: "自由國際", statGroup: "自由時報", url: "https://news.ltn.com.tw/rss/world.xml", maxCount: 5, priority: 8 },
    { category: "國際", sourceName: "中央社國際", statGroup: "中央社 CNA", url: "https://feeds.feedburner.com/rsscna/intworld", maxCount: 2, priority: 6 },
    { category: "國際", sourceName: "RTHK國際", statGroup: "香港電台", url: "https://rthk.hk/rthk/news/rss/c_expressnews_cinternational.xml", maxCount: 3, priority: 5 },

    // 🇨🇳🇹🇼 兩岸
    { category: "兩岸", sourceName: "三立新聞網", statGroup: "三立新聞網", url: "https://news.google.com/rss/search?q=site:tw.news.yahoo.com+%E4%B8%89%E7%AB%8B%E6%96%B0%E8%81%9E%E7%B6%B2+when:1d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant", maxCount: 5, priority: 13 },
    { category: "兩岸", sourceName: "三立新聞網", statGroup: "三立新聞網", url: "https://www.bing.com/news/search?q=site:setn.com+%E6%94%BF%E6%B2%BB&setmkt=zh-TW&format=rss", maxCount: 5, priority: 13 },
    { category: "兩岸", sourceName: "壹蘋新聞網", statGroup: "壹蘋新聞網", url: "https://www.bing.com/news/search?q=site:nextapple.com+%E6%94%BF%E6%B2%BB&setmkt=zh-TW&format=rss", maxCount: 5, priority: 13 },
    { category: "兩岸", sourceName: "壹蘋新聞網", statGroup: "壹蘋新聞網", url: "https://news.google.com/rss/search?q=site:tw.nextapple.com+(%E6%94%BF%E6%B2%BB+OR+%E5%85%A9%E5%B2%B8)+when:1d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant", maxCount: 4, priority: 13 },
    { category: "兩岸", sourceName: "壹電視", statGroup: "壹電視", url: "https://www.bing.com/news/search?q=site:nexttv.com.tw&setmkt=zh-TW&format=rss", maxCount: 5, priority: 12 },
    { category: "兩岸", sourceName: "自由時報", statGroup: "自由時報", url: "https://news.ltn.com.tw/rss/politics.xml", maxCount: 5, priority: 12 },
    { category: "兩岸", sourceName: "中央社 CNA", statGroup: "中央社 CNA", url: "https://feeds.feedburner.com/rsscna/china", maxCount: 2, priority: 5 },
    { category: "兩岸", sourceName: "RTHK兩岸", statGroup: "香港電台", url: "https://rthk.hk/rthk/news/rss/c_expressnews_greaterchina.xml", maxCount: 3, priority: 4 },

    // 🎬 娛樂
    { category: "娛樂", sourceName: "韓星 K-Pop", statGroup: "香港01", url: "https://www.bing.com/news/search?q=(K-Pop+OR+NewJeans+OR+BLACKPINK+OR+BTS+OR+%E9%9F%93%E6%98%9F+OR+%E9%9F%93%E5%8A%87)+site:hk01.com&setmkt=zh-HK&format=rss", maxCount: 6, priority: 11 },
    { category: "娛樂", sourceName: "香港01娛樂", statGroup: "香港01", url: "https://www.bing.com/news/search?q=site:hk01.com+%E5%8D%B3%E6%99%82%E5%A8%9B%E6%A8%82&setmkt=zh-HK&format=rss", maxCount: 7, priority: 11 },
    { category: "娛樂", sourceName: "壹蘋娛樂", statGroup: "壹蘋新聞網", url: "https://news.google.com/rss/search?q=site:tw.nextapple.com+%E5%A8%9B%E6%A8%82+when:1d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant", maxCount: 6, priority: 10 },
    { category: "娛樂", sourceName: "自由娛樂", statGroup: "自由時報", url: "https://news.ltn.com.tw/rss/entertainment.xml", maxCount: 6, priority: 10 },

    // ⚽ 體育（已順手修正足球焦點歸類至香港01）
    { category: "體育", sourceName: "足球焦點", statGroup: "香港01", url: "https://www.bing.com/news/search?q=(%E8%8B%B1%E8%B6%85+OR+%E8%A5%BF%E7%94%B2+OR+%E6%AD%90%E5%86%A0+OR+%E4%B8%96%E7%95%8C%E7%9B%83)+site:hk01.com&setmkt=zh-HK&format=rss", maxCount: 6, priority: 12 },
    { category: "體育", sourceName: "NBA 戰報", statGroup: "香港01", url: "https://www.bing.com/news/search?q=NBA+site:hk01.com&setmkt=zh-HK&format=rss", maxCount: 6, priority: 12 },
    { category: "體育", sourceName: "體壇及港隊", statGroup: "香港01", url: "https://www.bing.com/news/search?q=(%E6%B8%AF%E9%9A%8A+OR+%E5%BC%B5%E5%AE%B6%E6%9C%97+OR+%E4%BD%95%E8%A9%A9%E8%93%93+OR+%E7%B6%B2%E7%90%83+OR+F1+OR+%E7%BE%BD%E6%AF%9B%E7%90%83+OR+%E6%A1%8C%E7%90%83)+site:hk01.com&setmkt=zh-HK&format=rss", maxCount: 6, priority: 11 },
    { category: "體育", sourceName: "自由體育", statGroup: "自由時報", url: "https://news.ltn.com.tw/rss/sports.xml", maxCount: 5, priority: 9 },
    { category: "體育", sourceName: "RTHK體育", statGroup: "香港電台", url: "https://rthk.hk/rthk/news/rss/c_expressnews_csport.xml", maxCount: 4, priority: 6 }
  ];
}

function ensureSafeUrl(url) {
  if (!url) return "";
  let clean = url.trim().replace(/\s+/g, "%20");
  try {
    if (/[^\x00-\x7F]/.test(clean)) clean = encodeURI(clean);
  } catch (e) {}
  return clean;
}

function needsDeepContentFetch(body) {
  if (!body) return true;
  const t = body.trim();
  if (t.length < 360) return true;
  if (/(\.{2,}|…)\s*$/.test(t)) return true;
  if (!/[。！？!?”"」』）)】\]\.]$/.test(t)) return true;
  return false;
}

function cleanTruncatedTail(text) {
  if (!text) return "";
  let t = text.trim();

  const paras = t.split(/\n\n+/);
  if (paras.length >= 2) {
    const lastP = paras[paras.length - 1].trim();
    if (/(\.{2,}|…)\s*$/.test(lastP) && lastP.length < 32) {
      paras.pop();
      t = paras.join("\n\n").trim();
    }
  }

  if (/(\.{2,}|…)\s*$/.test(t)) {
    const withoutDots = t.replace(/\s*(\.{2,}|…)\s*$/, "");
    const lastFullStop = Math.max(
      withoutDots.lastIndexOf("。"),
      withoutDots.lastIndexOf("！"),
      withoutDots.lastIndexOf("？"),
      withoutDots.lastIndexOf("」"),
      withoutDots.lastIndexOf("』")
    );
    const lastComma = Math.max(
      withoutDots.lastIndexOf("，"),
      withoutDots.lastIndexOf("、"),
      withoutDots.lastIndexOf("；")
    );

    if (lastFullStop !== -1 && lastFullStop >= withoutDots.length - 50) {
      t = withoutDots.substring(0, lastFullStop + 1);
    } else if (lastComma !== -1 && lastComma > 25) {
      t = withoutDots.substring(0, lastComma) + "。";
    } else {
      t = withoutDots + "。";
    }
  }

  const updatedParas = t.split(/\n\n+/);
  if (updatedParas.length > 0) {
    let lastPara = updatedParas[updatedParas.length - 1].trim();
    const hasTerminalPunct = /[。！？!?”"」』）)】\]\.]$/.test(lastPara);
    const hasUnclosedQuote = (lastPara.lastIndexOf("「") > lastPara.lastIndexOf("」")) ||
                             (lastPara.lastIndexOf("『") > lastPara.lastIndexOf("』"));

    if ((!hasTerminalPunct || hasUnclosedQuote) && lastPara.length >= 22 && !/^•\s/.test(lastPara)) {
      const lastStop = Math.max(lastPara.lastIndexOf("。"), lastPara.lastIndexOf("！"), lastPara.lastIndexOf("？"));
      const lastComma = Math.max(lastPara.lastIndexOf("，"), lastPara.lastIndexOf("；"));

      if (lastStop >= 35) {
        lastPara = lastPara.substring(0, lastStop + 1);
        updatedParas[updatedParas.length - 1] = lastPara;
        t = updatedParas.join("\n\n").trim();
      } else if (lastComma >= 18 && (lastPara.length - lastComma) <= 32) {
        const candidate = lastPara.substring(0, lastComma);
        if (candidate.lastIndexOf("「") > candidate.lastIndexOf("」") && lastStop >= 10) {
          lastPara = lastPara.substring(0, lastStop + 1);
        } else {
          lastPara = candidate + "。";
        }
        updatedParas[updatedParas.length - 1] = lastPara;
        t = updatedParas.join("\n\n").trim();
      } else if (updatedParas.length >= 2 && lastStop === -1 && lastPara.length < 45) {
        updatedParas.pop();
        t = updatedParas.join("\n\n").trim();
      }
    }
  }
  return t.trim();
}

function extractRealPublishTimestamp(html, nowMs) {
  if (!html) return null;
  const patterns = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|pubdate|publishdate|datePublished|og:pubdate)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["'](?:article:published_time|pubdate|publishdate|datePublished|og:pubdate)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /"pubDate"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i
  ];
  for (const reg of patterns) {
    const m = html.match(reg);
    if (m && m[1]) {
      const parsed = Date.parse(m[1].trim());
      if (!isNaN(parsed) && parsed > 1700000000000 && parsed <= (nowMs + 600000)) {
        return parsed;
      }
    }
  }
  return null;
}

function deduplicateAcrossMedia(items) {
  const accepted = [];
  const mediaAcceptedCount = {};

  for (const item of items) {
    const groupKey = item.statGroup || item.sourceName;
    const currentMediaCount = mediaAcceptedCount[groupKey] || 0;
    const allowLenientGuarantee = currentMediaCount < 2;

    item.clusterCount = 1;
    item.clusterGroups = [groupKey];

    const dupIdx = findCrossMediaDuplicate(item, accepted, allowLenientGuarantee);
    if (dupIdx === -1) {
      accepted.push(item);
      mediaAcceptedCount[groupKey] = currentMediaCount + 1;
    } else {
      const existing = accepted[dupIdx];
      if (existing.clusterGroups && !existing.clusterGroups.includes(groupKey)) {
        existing.clusterGroups.push(groupKey);
        existing.clusterCount = existing.clusterGroups.length;
      }
      if (!item.isDefaultOneAm && existing.isDefaultOneAm) {
        existing.timestamp = item.timestamp;
        existing.timeStr = item.timeStr;
        existing.isDefaultOneAm = false;
      }
      if (needsDeepContentFetch(existing.body) &&
          item.body && item.body.length > (existing.body || "").length &&
          !isSystemErrorNoise(item.body)) {
        existing.body = item.body;
      }
    }
  }
  return accepted;
}

function findCrossMediaDuplicate(candidate, existingList, onlyExactMatch) {
  const normCand = normalizeTitleKey(candidate.title);
  const isCandChinese = /[\u4e00-\u9fa5]{3,}/.test(candidate.title || "");
  const candBigrams = isCandChinese ? extractTitleBigrams(candidate.title) : [];
  const candWords = !isCandChinese ? extractEnglishWords(candidate.title) : [];

  for (let i = 0; i < existingList.length; i++) {
    const ex = existingList[i];
    if (normalizeTitleKey(ex.title) === normCand) return i;

    const isExChinese = /[\u4e00-\u9fa5]{3,}/.test(ex.title || "");
    if (isCandChinese !== isExChinese) continue;

    if (ex.category === candidate.category || (ex.category !== "娛樂" && ex.category !== "體育")) {
      if (isCandChinese) {
        const exBigrams = extractTitleBigrams(ex.title);
        if (candBigrams.length < 3 || exBigrams.length < 3) continue;

        let shared = 0;
        for (const bg of candBigrams) {
          if (exBigrams.includes(bg)) shared++;
        }
        const diceScore = (2 * shared) / (candBigrams.length + exBigrams.length);
        if (shared >= 6 || (shared >= 4 && diceScore >= 0.40)) {
          if (onlyExactMatch && ex.statGroup !== candidate.statGroup) {
            if (ex.clusterGroups && !ex.clusterGroups.includes(candidate.statGroup)) {
              ex.clusterGroups.push(candidate.statGroup);
              ex.clusterCount = ex.clusterGroups.length;
            }
            continue;
          }
          return i;
        }
      } else {
        const exWords = extractEnglishWords(ex.title);
        if (candWords.length < 3 || exWords.length < 3) continue;

        let sharedW = 0;
        for (const w of candWords) {
          if (exWords.includes(w)) sharedW++;
        }
        const wordDice = (2 * sharedW) / (candWords.length + exWords.length);
        if (sharedW >= 4 && wordDice >= 0.45) {
          if (onlyExactMatch && ex.statGroup !== candidate.statGroup) continue;
          return i;
        }
      }
    }
  }
  return -1;
}

function extractTitleBigrams(title) {
  if (!title) return [];
  const cleaned = title
    .replace(/^(有片|多圖|直擊|突發|快訊|最新|不斷更新|獨家|專訪)\s*[|｜:：\-—]?\s*/g, "")
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
    .toLowerCase();
  const bigrams = [];
  for (let i = 0; i < cleaned.length - 1; i++) {
    const bg = cleaned.slice(i, i + 2);
    if (!bigrams.includes(bg)) bigrams.push(bg);
  }
  return bigrams;
}

function extractEnglishWords(title) {
  if (!title) return [];
  const stopWords = ["with", "from", "that", "this", "have", "more", "after", "over", "into", "says", "said", "amid", "what", "when", "where", "news", "world", "reuters", "bbc"];
  const rawWords = title.toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const words = [];
  for (const w of rawWords) {
    if (!stopWords.includes(w) && !words.includes(w)) words.push(w);
  }
  return words;
}

function parseRssXml(xmlText, srcConfig, nowMs) {
  const results = [];
  if (!xmlText) return results;

  const items = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const rawItem of items) {
    let title = extractXmlTag(rawItem, "title");
    let link = extractXmlTag(rawItem, "link");
    const pubDateStr = extractXmlTag(rawItem, "pubDate") || extractXmlTag(rawItem, "dc:date");
    const contentEncoded = extractXmlTag(rawItem, "content:encoded");
    const description = extractXmlTag(rawItem, "description");
    const xmlCategory = extractAllXmlTags(rawItem, "category");

    if (!title || !link) continue;

    link = ensureSafeUrl(unwrapRedirectUrl(link));
    title = cleanHeadline(title);
    if (!title || isVideoProgramTitle(title)) continue;
    if (!srcConfig.needTranslate && !hasEnoughChinese(title, "")) continue;
    if (link.includes("881903.com") && /(\/program\/|\/my903\/|\/column\/|\/live\/|\/song\/)/i.test(link)) continue;

    const urlDateMatch = link.match(/\/(202\d)(\d{2})(\d{2})\//);
    if (urlDateMatch) {
      const urlDateMs = Date.parse(`${urlDateMatch[1]}-${urlDateMatch[2]}-${urlDateMatch[3]}T23:59:59+08:00`);
      if (!isNaN(urlDateMs) && (nowMs - urlDateMs) > MAX_NEWS_AGE_MS) continue;
    }

    const isGoogleNewsRss = link.includes("news.google.com");
    let formattedBody = "";
    if (!isGoogleNewsRss) {
      const rawBody = (contentEncoded && contentEncoded.length > description.length) ? contentEncoded : description;
      formattedBody = formatMultiParagraphText(rawBody, title);
    } else {
      formattedBody = extractGoogleNewsClusterSubtitles(description, title);
    }

    if (formattedBody && isSystemErrorNoise(formattedBody)) continue;

    const correctedCat = smartCorrectCategory(srcConfig.category, title, formattedBody, xmlCategory, srcConfig.sourceName);
    const displaySourceName = normalizeDisplaySourceName(srcConfig.sourceName, correctedCat);

    let ts = nowMs;
    if (pubDateStr) {
      const parsedTime = Date.parse(pubDateStr);
      if (!isNaN(parsedTime)) ts = parsedTime > nowMs ? nowMs : parsedTime;
    }

    const formattedTime = formatHkShort(ts);
    const isDefaultOneAm = formattedTime.includes(" 01:00") || formattedTime.includes(" 00:00") || formattedTime.includes(" 08:00");

    results.push({
      category: correctedCat,
      xmlCategory,
      sourceName: displaySourceName,
      statGroup: srcConfig.statGroup || srcConfig.sourceName,
      needTranslate: !!srcConfig.needTranslate,
      priority: srcConfig.priority || 5,
      title,
      body: formattedBody,
      link,
      timestamp: ts,
      timeStr: formattedTime,
      isDefaultOneAm
    });
  }
  return results;
}

function unwrapRedirectUrl(url) {
  if (!url) return "";
  const match = url.match(/[?&]url=([^&]+)/i);
  if (match && match[1]) {
    try { return decodeURIComponent(match[1]); } catch (e) {}
  }
  return url;
}

function isScoreOnlyHighlightTitle(title) {
  if (!title) return false;
  const t = title.trim();
  const hasActionWord = /(勝|負|和|挫|敗|取|贏|輸|敵|殺|破|入球|建功|領先|反勝|大勝|險勝|迫和|言和|出局|晉級|奪冠|連勝|連敗|傷|罰|紀錄|雙雙|得分)/.test(t);
  if (hasActionWord) return false;
  return /\b\d{1,2}\s*[:\-－比]\s*\d{1,2}\b/.test(t) && t.length <= 26;
}

function isBreakingOrMajorNews(title, body) {
  const combined = (title || "") + " " + (body || "");
  return BREAKING_VIP_KEYWORDS.some(kw => combined.includes(kw));
}

async function resolveGoogleNewsUrls(items) {
  const gnewsTargets = [];
  items.forEach((item, index) => {
    if (item.link && item.link.includes("news.google.com")) {
      const m = item.link.match(/\/articles\/([a-zA-Z0-9_-]+)/);
      if (m && m[1]) {
        gnewsTargets.push({ index, articleId: m[1], url: "https://news.google.com/rss/articles/" + m[1] });
      }
    }
  });

  if (gnewsTargets.length === 0) return;

  const pageReqs = gnewsTargets.map(t => ({
    url: t.url,
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
  }));
  const pageResponses = await fetchBatch(pageReqs, 10, 10000);

  const rpcRequests = [];
  const rpcTargetMap = [];

  pageResponses.forEach((res, i) => {
    if (!res || res.status !== 200) return;
    const sgMatch = res.text.match(/data-n-a-sg=["']([^"']+)["']/);
    const tsMatch = res.text.match(/data-n-a-ts=["']([^"']+)["']/);
    if (sgMatch && tsMatch) {
      const innerPayload = ["garturlreq", [["zh-HK", "HK", ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"], null, null, 1, 1, "HK:zh-Hant", null, 480, null, null, null, null, null, 0, 1], "zh-HK", "HK", 1, [2, 4, 8], 1, 1, null, 0, 0, null, 0], gnewsTargets[i].articleId, Number(tsMatch[1]), sgMatch[1]];
      const fReq = [[["Fbv4je", JSON.stringify(innerPayload), null, "generic"]]];
      rpcRequests.push({
        url: "https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        body: "f.req=" + encodeURIComponent(JSON.stringify(fReq))
      });
      rpcTargetMap.push(gnewsTargets[i].index);
    }
  });

  if (rpcRequests.length === 0) return;
  const rpcResponses = await fetchBatch(rpcRequests, 10, 10000);
  rpcResponses.forEach((res, i) => {
    if (!res || res.status !== 200) return;
    const urlMatch = res.text.replace(/\\"/g, '"').replace(/\\\\/g, "\\").match(/\["garturlres","(https?:\/\/[^"]+)"/);
    if (urlMatch && urlMatch[1]) items[rpcTargetMap[i]].link = ensureSafeUrl(urlMatch[1]);
  });
}

async function enrichArticlesDeepContent(items, nowMs) {
  const targets = [];
  items.forEach((item, index) => {
    item.body = stripVideoFallbackNoise(item.body);
    if ((needsDeepContentFetch(item.body) || item.isDefaultOneAm) &&
        item.link && item.link.startsWith("http") && !item.link.includes("news.google.com")) {
      const safeLink = ensureSafeUrl(item.link);
      if (safeLink) {
        item.link = safeLink;
        targets.push({ index, url: safeLink });
      }
    }
  });

  if (targets.length === 0) return;

  const requests = targets.map(t => ({
    url: t.url,
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept-Language": "zh-HK,zh-TW;q=0.9,zh;q=0.8,en;q=0.7"
    }
  }));

  const responses = await fetchBatch(requests, 12, 12000);
  responses.forEach((res, i) => {
    if (!res || res.status !== 200) return;
    const item = items[targets[i].index];
    const html = res.text;

    const realTs = extractRealPublishTimestamp(html, nowMs);
    if (realTs) {
      item.timestamp = realTs;
      item.timeStr = formatHkShort(realTs);
      item.isDefaultOneAm = false;
    }

    let extracted = extractArticleParagraphsFromHtml(html, item.title);
    if (!extracted || isSystemErrorNoise(extracted)) return;
    extracted = cleanTruncatedTail(stripVideoFallbackNoise(extracted));

    if (!item.needTranslate && !hasEnoughChinese(item.title, extracted)) return;

    const oldBody = (item.body || "").trim();
    const oldIncomplete = /(\.{2,}|…)\s*$/.test(oldBody) || !/[。！？!?”"」』）)】\]\.]$/.test(oldBody);
    const newComplete = !/(\.{2,}|…)\s*$/.test(extracted) && /[。！？!?”"」』）)】\]\.]$/.test(extracted);

    if (extracted.length > oldBody.length || (oldIncomplete && newComplete && extracted.length >= 45)) {
      item.body = extracted;
    }
  });
}

function extractArticleParagraphsFromHtml(html, articleTitle) {
  if (!html) return "";

  const nextDataMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch && nextDataMatch[1]) {
    try {
      const paraMatches = nextDataMatch[1].match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g);
      if (paraMatches && paraMatches.length > 0) {
        const hk01Paras = [];
        for (const pm of paraMatches) {
          const valMatch = pm.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          if (valMatch && valMatch[1]) {
            const decodedP = stripVideoFallbackNoise(stripHtmlTags(JSON.parse('"' + valMatch[1] + '"'))).trim();
            if (decodedP.length >= 22 && !isBoilerplateParagraph(decodedP) &&
                (!articleTitle || decodedP !== articleTitle.trim()) && !hk01Paras.includes(decodedP)) {
              hk01Paras.push(decodedP);
            }
          }
          if (hk01Paras.length >= 7) break;
        }
        if (hk01Paras.length >= 2) return hk01Paras.join("\n\n");
      }
    } catch (e) {}
  }

  const cleanedHtml = html
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<twitter-widget[\s\S]*?<\/twitter-widget>/gi, "")
    .replace(/<div[^>]+data-desc=["']熱門推播["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<div[^>]+class=["'][^"']*related[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<video[\s\S]*?<\/video>/gi, "")
    .replace(/<figure[\s\S]*?<\/figure>/gi, "")
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");

  const ltnMatch = cleanedHtml.match(/<div[^>]+data-desc=["']內容頁["'][^>]*>([\s\S]*?)<\/div>/i);
  if (ltnMatch && ltnMatch[1]) {
    const ltnParas = extractCleanPTags(ltnMatch[1], articleTitle, 7);
    if (ltnParas.length >= 2) return ltnParas.join("\n\n");
  }

  const setnMatch = cleanedHtml.match(/<div[^>]+id=["']Content1["'][^>]*>([\s\S]*?)<\/div>/i);
  if (setnMatch && setnMatch[1]) {
    const setnParas = extractCleanPTags(setnMatch[1], articleTitle, 7);
    if (setnParas.length >= 2) return setnParas.join("\n\n");
  }

  const nowMatch = cleanedHtml.match(/<div[^>]+class=["'][^"']*newsLeading[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (nowMatch && nowMatch[1]) {
    const nowText = formatMultiParagraphText(nowMatch[1], articleTitle);
    if (nowText.length >= 35) return nowText;
  }

  const jsonLdMatch = html.match(/"articleBody"\s*:\s*"((?:[^"\\]|\\.)*)"/i);
  if (jsonLdMatch && jsonLdMatch[1]) {
    try {
      const formatted = formatMultiParagraphText(JSON.parse('"' + jsonLdMatch[1] + '"'), articleTitle);
      if (formatted.length >= 60 && !/(\.{2,}|…)\s*$/.test(formatted) && /[。！？!?”"」』）)】\)]$/.test(formatted)) {
        return formatted;
      }
    } catch (e) {}
  }

  const articleTagMatch = cleanedHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleTagMatch && articleTagMatch[1]) {
    const artParas = extractCleanPTags(articleTagMatch[1], articleTitle, 7);
    if (artParas.length >= 2) return artParas.join("\n\n");
    if (artParas.length === 1 && artParas[0].length >= 85) return formatMultiParagraphText(artParas[0], articleTitle);
  }

  const paragraphs = extractCleanPTags(cleanedHtml, articleTitle, 7);
  if (paragraphs.length >= 2) return paragraphs.join("\n\n");
  if (paragraphs.length === 1 && paragraphs[0].length >= 110) return formatMultiParagraphText(paragraphs[0], articleTitle);

  let metaDesc = "";
  const ogMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i) ||
                  html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i) ||
                  html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (ogMatch && ogMatch[1]) {
    metaDesc = cleanTruncatedTail(formatMultiParagraphText(decodeHtmlEntities(ogMatch[1]), articleTitle));
  }

  if (paragraphs.length === 1) {
    const p0 = cleanTruncatedTail(paragraphs[0]);
    const p0Complete = /[。！？!?”"」』）)】\)]$/.test(p0);
    const metaComplete = /[。！？!?”"」』）)】\)]$/.test(metaDesc);
    if (p0Complete && !metaComplete && p0.length >= 40) return p0;
    return metaDesc.length > p0.length ? metaDesc : p0;
  }
  return metaDesc;
}

function extractCleanPTags(htmlBlock, articleTitle, maxParas) {
  const paragraphs = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = pRegex.exec(htmlBlock)) !== null) {
    const subChunks = match[1].replace(/<br\s*\/?>/gi, "\n").split(/\n+/);
    for (const rawChunk of subChunks) {
      const pText = stripVideoFallbackNoise(stripHtmlTags(rawChunk)).trim();
      if (pText.length < 18 || isBoilerplateParagraph(pText)) continue;
      if (articleTitle && pText === articleTitle.trim()) continue;
      if (!paragraphs.includes(pText)) paragraphs.push(pText);
      if (paragraphs.length >= (maxParas || 7)) break;
    }
    if (paragraphs.length >= (maxParas || 7)) break;
  }
  return paragraphs;
}

function stripVideoFallbackNoise(text) {
  if (!text) return "";
  return text
    .replace(/^[^\n]{0,140}（[^）]{1,35}(?:提供|翻攝|攝)）\s*(?=〔記者)/g, "")
    .replace(/為達最佳瀏覽效果，建議使用[^\n]*瀏覽器。?/g, "")
    .replace(/不用抽\s*不用搶[^\n]*按我看活動辦法/g, "")
    .replace(/此網頁已閒置超過\s*\d+\s*分鐘[\s\S]*$/g, "")
    .replace(/([。！？！」』])\s*\?{2,}[\s\S]*$/g, "$1")
    .replace(/\?{3,}[\s\S]*$/g, "")
    .replace(/https?:\/\/t\.co\/[a-zA-Z0-9]+[\s\S]*$/g, "")
    .replace(/—\s*[^\n]*\(@[A-Za-z0-9_]+\)\s*[A-Z][a-z]+\s+\d{1,2},\s*\d{4}[\s\S]*$/g, "")
    .replace(/\(@[A-Za-z0-9_]+\)\s*[A-Z][a-z]+\s+\d{1,2},\s*\d{4}[\s\S]*$/g, "")
    .replace(/請繼續往下閱讀\.{0,3}\s*/g, "")
    .replace(/displayDFP\([^)]*\)\s*;?/gi, "")
    .replace(/googletag\.cmd\.push\([^)]*\)\s*;?/gi, "")
    .replace(/【更多內容\s*請見影片】/g, "")
    .replace(/訂閱【自由追新聞】[\s\S]*/g, "")
    .replace(/全新的視界！新聞話題不漏接[\s\S]*/g, "")
    .replace(/To view this video please enable JavaScript,?\s*and consider upgrading to a web browser that supports HTML5 video\.?/gi, "")
    .replace(/To view this video please enable JavaScript[\s\S]*?HTML5 video\.?/gi, "")
    .replace(/We're sorry but [\s\S]*?without JavaScript enabled\.?\s*(Please enable it to continue\.?)?/gi, "")
    .replace(/We're sorry but the website doesn't work properly[\s\S]*/gi, "")
    .replace(/娛樂星聞\s*iNEWS\s*祝你健康\s*三立導讀[\s\S]*?(?=\n|$)/gi, "")
    .replace(/（圖／[^）]*）\s*導覽目錄：?/g, "")
    .replace(/導覽目錄：?/g, "")
    .replace(/圖片來源：[^\n]+\s*圖片說明：[^\n]+/g, "")
    .replace(/^圖片來源：[^\n]+$/gm, "")
    .replace(/^圖片說明：[^\n]+$/gm, "")
    .replace(/^Image source,[^\n]+$/gim, "")
    .replace(/^Image caption,[^\n]+$/gim, "")
    .replace(/^[\s.…·•\-—?]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isVideoProgramTitle(title) {
  if (!title) return false;
  const t = title.trim();
  if (/^(LIVE\s*[-｜|／/]|直播\s*[-｜|／/]|【直播】|【LIVE】|【重溫】|\[重溫\]|重溫\s*[-｜|:：])/i.test(t)) return true;
  return VIDEO_ONLY_PROGRAMS.some(prog => t.includes(prog));
}

function isSystemErrorNoise(text) {
  if (!text) return false;
  const errKeywords = [
    "今集為大家Follow-Up", "今集為大家", "今集同大家", "請留意今集",
    "詳盡報道本地時事、大中華消息", "國際局勢等新聞，緊貼最新熱話",
    "To view this video please enable JavaScript", "supports HTML5 video",
    "We're sorry but the website doesn't work properly", "without JavaScript enabled",
    "Please enable it to continue", "娛樂星聞 iNEWS 祝你健康 三立導讀",
    "寶島神很大 富房網", "請見影片", "訂閱【自由追新聞】", "記得開啟小鈴鐺",
    "為達最佳瀏覽效果，建議使用", "此網頁已閒置超過5分鐘", "不用抽 不用搶",
    "【商業電台 881903 即時報道】", "【商業電台即時新聞】"
  ];
  const lower = text.toLowerCase();
  return errKeywords.some(kw => lower.includes(kw.toLowerCase()));
}

function isBoilerplateParagraph(text) {
  if (!text) return true;
  if (isSystemErrorNoise(text)) return true;
  if (/\?{4,}/.test(text) || /https?:\/\/t\.co\//.test(text)) return true;
  const junk = [
    "今集為大家", "今集同大家", "詳盡報道本地時事", "緊貼最新熱話",
    "版權所有，不得轉載", "未經授權，不得轉載", "立即下載App", "下載《香港01》App",
    "訂閱電子報", "Privacy Policy", "Terms of Use", "All rights reserved",
    "點擊瀏覽更多", "追蹤我們：", "廣告查詢", "免責聲明：", "延伸閱讀：", "星島頭條",
    "娛樂星聞", "三立導讀", "寶島神很大", "祝你健康", "導覽目錄",
    "Image source,", "Image caption,", "圖片來源：", "圖片說明：",
    "快訂閱YouTube", "開啟小鈴鐺", "自由追新聞",
    "為達最佳瀏覽效果", "不用抽 不用搶", "現在用APP看新聞", "保證天天中獎",
    "點我下載APP", "按我看活動辦法", "此網頁已閒置超過5分鐘", "熱門推播"
  ];
  const lower = text.toLowerCase();
  return junk.some(keyword => lower.includes(keyword.toLowerCase()));
}

function extractGoogleNewsClusterSubtitles(descHtml, mainTitle) {
  if (!descHtml) return "";
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  const lines = [];
  let m;
  while ((m = liRegex.exec(descHtml)) !== null) {
    const line = cleanHeadline(stripHtmlTags(m[1]).trim());
    if (line && line.length > 12 && line !== mainTitle && !lines.includes(line)) {
      lines.push("• " + line);
    }
  }
  return lines.join("\n\n");
}

async function translateWithGemini(text) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !text) return "";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: "請將以下英文新聞準確翻譯為香港新聞常用的繁體中文書面語，保留原本的段落換行，只輸出譯文，不要加入任何前綴、註解或標題：\n\n" + text
        }]
      }]
    })
  }, 15000);
  if (res.status !== 200) return "";
  try {
    const data = JSON.parse(res.text);
    const out = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    return /[\u4e00-\u9fa5]/.test(out) ? out : "";
  } catch (e) {
    return "";
  }
}

async function translateWithGtx(text) {
  if (!text) return "";
  const paras = text.split(/\n\n+/);
  const translated = [];
  for (const p of paras) {
    const chunk = p.trim();
    if (!chunk) continue;
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=" + encodeURIComponent(chunk.slice(0, 1800));
    const res = await safeFetch(url, {}, 10000);
    if (res.status === 200) {
      try {
        const data = JSON.parse(res.text);
        if (data && data[0]) {
          translated.push(data[0].map(seg => seg[0] || "").join(""));
          continue;
        }
      } catch (e) {}
    }
    translated.push(chunk);
  }
  return translated.join("\n\n");
}

async function translateTextWithFallback(text) {
  if (!text) return "";
  const geminiRes = await translateWithGemini(text);
  if (geminiRes) return geminiRes;
  const gtxRes = await translateWithGtx(text);
  return gtxRes || text;
}

async function translateForeignArticles(items, previousPayload) {
  const prevCache = new Map();
  if (previousPayload && Array.isArray(previousPayload.items)) {
    for (const oldItem of previousPayload.items) {
      if (oldItem.isTranslated && /[\u4e00-\u9fa5]/.test(oldItem.title || "")) {
        if (oldItem.link) prevCache.set(oldItem.link, oldItem);
        if (oldItem.origTitle) prevCache.set(oldItem.origTitle, oldItem);
      }
    }
  }

  for (const item of items) {
    if (!item.needTranslate) continue;
    item.origTitle = item.origTitle || item.title;

    const cached = prevCache.get(item.link) || prevCache.get(item.origTitle);
    if (cached && cached.title && cached.body && cached.body.length >= 40) {
      item.title = cached.title;
      item.body = cached.body;
      item.isTranslated = true;
      continue;
    }

    try {
      if (item.title && /[a-zA-Z]{4,}/.test(item.title)) {
        item.title = cleanHeadline(await translateTextWithFallback(item.title));
      }
      if (item.body && /[a-zA-Z]{4,}/.test(item.body)) {
        const transBody = await translateTextWithFallback(item.body);
        item.body = cleanTruncatedTail(stripVideoFallbackNoise(transBody));
      }
      item.isTranslated = true;
    } catch (e) {}
  }
}

function enforceSourceQuota(items) {
  const sourceCounter = {};
  const catCounter = {};
  const catMaxLimits = { "港聞": 50, "國際": 36, "兩岸": 28, "娛樂": 26, "體育": 26 };
  const result = [];

  for (const item of items) {
    const cat = item.category;
    const srcKey = cat + "_" + item.sourceName;

    let srcLimit = 8;
    if (cat === "港聞" && (item.sourceName === "有線新聞" || item.sourceName === "Now 新聞" || item.sourceName === "香港01")) {
      srcLimit = 10;
    } else if (item.sourceName.includes("RTHK")) {
      if (cat === "港聞") srcLimit = 6;
      else if (cat === "體育") srcLimit = 4;
      else srcLimit = 3;
    } else if (item.sourceName.includes("中央社")) {
      srcLimit = 2;
    }

    const currentSrcCount = sourceCounter[srcKey] || 0;
    const currentCatCount = catCounter[cat] || 0;
    const maxCat = catMaxLimits[cat] || 30;

    if (currentSrcCount < srcLimit && currentCatCount < maxCat) {
      sourceCounter[srcKey] = currentSrcCount + 1;
      catCounter[cat] = currentCatCount + 1;
      result.push(item);
    }
  }
  return result;
}

function selectBalancedPool(items, maxPoolSize) {
  const categories = ["港聞", "國際", "兩岸", "娛樂", "體育"];
  const catBuckets = {};
  categories.forEach(cat => {
    catBuckets[cat] = items.filter(it => it.category === cat).sort((a, b) => b.timestamp - a.timestamp);
  });

  const goldenCyclePattern = [
    "港聞", "國際", "兩岸", "娛樂", "體育",
    "港聞", "國際", "港聞",
    "兩岸", "娛樂", "體育", "港聞", "國際",
    "港聞", "國際", "兩岸", "娛樂", "體育",
    "港聞", "國際", "兩岸", "娛樂", "體育",
    "港聞"
  ];

  const balanced = [];
  let hasMore = true;
  while (hasMore && balanced.length < maxPoolSize) {
    hasMore = false;
    for (const cat of goldenCyclePattern) {
      if (catBuckets[cat] && catBuckets[cat].length > 0) {
        balanced.push(catBuckets[cat].shift());
        hasMore = true;
        if (balanced.length >= maxPoolSize) break;
      }
    }
  }
  return balanced;
}

function sortItemsByTimeDesc(items) {
  return items.slice().sort((a, b) => {
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return (b.priority || 5) - (a.priority || 5);
  });
}

function formatMultiParagraphText(rawHtml, titleToStrip) {
  if (!rawHtml) return "";
  const text = stripVideoFallbackNoise(decodeHtmlEntities(
    rawHtml
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<video[\s\S]*?<\/video>/gi, "")
      .replace(/<figure[\s\S]*?<\/figure>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
  ));
  const lines = text.split(/\n+/).map(l => l.trim()).filter(l =>
    l && l.length >= 8 &&
    !l.includes("Comprehensive up-to-date news coverage") &&
    !isBoilerplateParagraph(l) &&
    (!titleToStrip || l !== titleToStrip.trim())
  );
  if (lines.length === 1 && lines[0].length > 130) {
    const sentences = lines[0].split(/(?<=[。！？])\s*/).filter(Boolean);
    const chunkedParagraphs = [];
    let currentPara = "";
    sentences.forEach(s => {
      currentPara += s;
      if (currentPara.length >= 75) { chunkedParagraphs.push(currentPara.trim()); currentPara = ""; }
    });
    if (currentPara.trim()) chunkedParagraphs.push(currentPara.trim());
    return cleanTruncatedTail(chunkedParagraphs.slice(0, 7).join("\n\n"));
  }
  return cleanTruncatedTail(lines.slice(0, 7).join("\n\n"));
}

function extractXmlTag(xml, tag) {
  const regex = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "i");
  const match = xml.match(regex);
  return match ? decodeHtmlEntities(match[1].trim().replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1")) : "";
}

function extractAllXmlTags(xml, tag) {
  if (!xml) return "";
  const regex = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "gi");
  const results = [];
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const val = decodeHtmlEntities(m[1].trim().replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1")).trim();
    if (val && !results.includes(val)) results.push(val);
  }
  return results.join(" ");
}

function cleanHeadline(title) {
  if (!title) return "";
  return title
    .replace(/\s*\(\d{1,2}:\d{2}\)\s*-\s*\d{8}\s*-\s*[^\s]+.*$/i, "")
    .replace(/\s*[|｜\-—_]\s*(國際|政治|兩岸|社會|娛樂|體育|生活|財經|突發|即時|焦點|熱門|大陸|港聞)\s*[|｜\-—_]\s*(三立新聞網|三立新聞|SETN|自由時報|自由娛樂|自由體育|壹蘋新聞網|香港01|有線新聞|Now\s*新聞|集誌社|獨立媒體|Yahoo奇摩新聞|Yahoo新聞|Yahoo).*$/i, "")
    .replace(/\s*[-|｜_]\s*(有線新聞|有線寬頻|i-CABLE|Now\s*新聞|Now\s*體育|香港01|01娛樂|01體育|01港聞|am730|商業電台|商台新聞|881903|集誌社|The\s*Collective\s*HK|獨立媒體|獨媒|三立新聞網|三立新聞|SETN\.com|SETN|壹蘋新聞網|壹蘋|壹電視|NextTV|自由時報|自由時報電子報|自由娛樂|自由體育|中央社|CNA|BBC\s*News|BBC|Reuters|路透社|Yahoo奇摩新聞|Yahoo新聞|Yahoo).*$/i, "")
    .trim();
}

function stripHtmlTags(str) {
  return decodeHtmlEntities((str || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function decodeHtmlEntities(str) {
  if (!str) return "";
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#8230;/g, "...")
    .replace(/&#(\d+);/g, (m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, code) => String.fromCharCode(parseInt(code, 16)));
}

function normalizeTitleKey(title) {
  return (title || "").replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "").slice(0, 16).toLowerCase();
}

function isBlacklisted(title, sourceName, link) {
  const checkStr = (title + " " + sourceName + " " + link).toLowerCase();
  return BLACKLIST_KEYWORDS.some(kw => checkStr.includes(kw.toLowerCase()));
}

async function main() {
  const nowMs = Date.now();
  const previousPayload = loadPreviousNews();
  const sources = getNewsSourcesConfig();

  const rawRequests = sources.map(src => ({
    url: ensureSafeUrl(src.url),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
      "Accept-Language": "zh-HK,zh-TW;q=0.9,zh;q=0.8,en-US;q=0.7"
    }
  }));

  const responses = await fetchBatch(rawRequests, 12, 12000);
  const rawCandidates = [];
  const rawStatsMap = {};

  responses.forEach((res, idx) => {
    const src = sources[idx];
    const statKey = src.statGroup || src.sourceName;
    if (!rawStatsMap[statKey]) {
      rawStatsMap[statKey] = { name: statKey, rawCount: 0, selectedCount: 0, ok: false };
    }
    if (!res || res.status !== 200 || !res.text) return;

    const parsed = parseRssXml(res.text, src, nowMs);
    if (parsed.length > 0) {
      rawStatsMap[statKey].ok = true;
      const isGNewsSource = src.url.includes("news.google.com");
      rawStatsMap[statKey].rawCount += isGNewsSource ? Math.min(parsed.length, 25) : parsed.length;
    }

    let added = 0;
    for (const item of parsed) {
      if (added >= src.maxCount) break;
      if ((nowMs - item.timestamp) > MAX_NEWS_AGE_MS) continue;
      if (isBlacklisted(item.title, item.sourceName, item.link)) continue;
      if (isVideoProgramTitle(item.title)) continue;
      if (!item.needTranslate && !hasEnoughChinese(item.title, "")) continue;
      if (item.category === "體育" && isScoreOnlyHighlightTitle(item.title)) continue;
      item.statGroup = statKey;
      rawCandidates.push(item);
      added++;
    }
  });

  rawCandidates.sort((a, b) => (b.priority !== a.priority) ? b.priority - a.priority : b.timestamp - a.timestamp);

  let candidateItems = deduplicateAcrossMedia(rawCandidates);
  candidateItems = selectBalancedPool(candidateItems, 180);

  await resolveGoogleNewsUrls(candidateItems);
  await enrichArticlesDeepContent(candidateItems, nowMs);

  candidateItems = candidateItems.filter(item => {
    if ((nowMs - item.timestamp) > MAX_NEWS_AGE_MS) return false;
    item.title = cleanHeadline(item.title);
    item.body = cleanTruncatedTail(stripVideoFallbackNoise(item.body));
    const bodyText = (item.body || "").trim();
    const titleText = (item.title || "").trim();

    if (isVideoProgramTitle(titleText)) return false;
    if (!item.needTranslate && !hasEnoughChinese(titleText, bodyText)) return false;

    item.category = smartCorrectCategory(item.category, titleText, bodyText, item.xmlCategory || "", item.sourceName);
    item.sourceName = normalizeDisplaySourceName(item.sourceName, item.category);

    const isBreaking = isBreakingOrMajorNews(titleText, bodyText);
    const isForeign = !!item.needTranslate;

    if (bodyText && isSystemErrorNoise(bodyText)) {
      if (isBreaking && item.category !== "娛樂" && item.category !== "體育" && !isSportsContent(titleText, bodyText)) {
        item.body = "【突發快訊】" + titleText + "（點擊下方按鈕前往原網站查看最新現場情況及完整報道）";
        return true;
      }
      return false;
    }

    if (item.category === "體育" && isScoreOnlyHighlightTitle(titleText) && bodyText.length < 45) return false;
    if (item.sourceName.includes("有線") && bodyText.length < 15 && !isBreaking) return false;

    const isSameAsTitle = !bodyText || bodyText === titleText || normalizeTitleKey(bodyText) === normalizeTitleKey(titleText);
    if (isSameAsTitle || bodyText.length < 18) {
      if (isBreaking && item.category !== "娛樂" && item.category !== "體育" && !isSportsContent(titleText, bodyText)) {
        item.body = "【突發快訊】" + titleText + "（點擊下方按鈕前往原網站查看最新現場情況及更新報道）";
        return true;
      }
      if (isForeign && titleText.length >= 15) {
        item.body = "【國際外電快訊】" + titleText + "\n\n（此為外電即時焦點快訊，點擊下方按鈕可前往原網站查閱完整報道及現場圖片。）";
        return true;
      }
      return false;
    }
    return true;
  });

  candidateItems = enforceSourceQuota(candidateItems);

  if (previousPayload && previousPayload.items && previousPayload.items.length > 0) {
    const prevStatsMap = {};
    if (previousPayload.sourceStats) {
      previousPayload.sourceStats.forEach(st => { prevStatsMap[st.name] = st; });
    }

    Object.keys(rawStatsMap).forEach(statKey => {
      const currentMediaItems = candidateItems.filter(it => (it.statGroup || it.sourceName) === statKey);
      if (currentMediaItems.length === 0) {
        const cachedForMedia = previousPayload.items.filter(it =>
          (it.statGroup === statKey || it.sourceName.includes(statKey.split(" ")[0])) &&
          it.timestamp && (nowMs - it.timestamp) <= MAX_NEWS_AGE_MS &&
          !isVideoProgramTitle(it.title) &&
          it.body && !isSystemErrorNoise(it.body) &&
          it.body.trim() !== it.title.trim() &&
          (it.needTranslate || hasEnoughChinese(it.title, it.body)) &&
          findCrossMediaDuplicate(it, candidateItems, true) === -1
        );
        if (cachedForMedia.length > 0) {
          const toRestore = cachedForMedia.slice(0, 4);
          toRestore.forEach(rit => {
            rit.title = cleanHeadline(rit.title);
            rit.body = cleanTruncatedTail(stripVideoFallbackNoise(rit.body));
            rit.statGroup = statKey;
            rit.category = smartCorrectCategory(rit.category, rit.title, rit.body, rit.xmlCategory || "", rit.sourceName);
            rit.sourceName = normalizeDisplaySourceName(rit.sourceName, rit.category);
            candidateItems.push(rit);
          });
          rawStatsMap[statKey].ok = true;
          if (rawStatsMap[statKey].rawCount === 0) {
            const prevRaw = (prevStatsMap[statKey] && prevStatsMap[statKey].rawCount) ? prevStatsMap[statKey].rawCount : toRestore.length;
            rawStatsMap[statKey].rawCount = Math.min(prevRaw, 25);
          }
        }
      }
    });

    ["港聞", "國際", "兩岸", "娛樂", "體育"].forEach(cat => {
      if (candidateItems.filter(it => it.category === cat).length < 3) {
        const prevCatItems = previousPayload.items.filter(it =>
          it.category === cat &&
          rawStatsMap[it.statGroup || it.sourceName] &&
          it.timestamp && (nowMs - it.timestamp) <= MAX_NEWS_AGE_MS &&
          !isVideoProgramTitle(it.title) &&
          it.body && !isSystemErrorNoise(it.body) &&
          it.body.trim() !== it.title.trim() &&
          (it.needTranslate || hasEnoughChinese(it.title, it.body)) &&
          findCrossMediaDuplicate(it, candidateItems, false) === -1
        );
        prevCatItems.slice(0, 5).forEach(pit => {
          pit.body = cleanTruncatedTail(stripVideoFallbackNoise(pit.body));
          candidateItems.push(pit);
        });
      }
    });
  }

  await translateForeignArticles(candidateItems, previousPayload);
  markBreakingNewsItems(candidateItems, nowMs);

  const finalItems = sortItemsByTimeDesc(candidateItems).slice(0, MAX_TOTAL_NEWS);
  finalItems.forEach(it => {
    const k = it.statGroup || it.sourceName;
    if (rawStatsMap[k]) {
      rawStatsMap[k].selectedCount++;
      rawStatsMap[k].ok = true;
      if (rawStatsMap[k].rawCount < rawStatsMap[k].selectedCount) {
        rawStatsMap[k].rawCount = rawStatsMap[k].selectedCount;
      }
    }
  });

  const payload = {
    version: APP_VERSION,
    updatedAt: formatHkShort(nowMs),
    fullUpdatedAt: formatHkFull(nowMs),
    sourceStats: Object.keys(rawStatsMap).map(k => rawStatsMap[k]),
    items: finalItems
  };

  if (finalItems.length < 10 && previousPayload && previousPayload.items && previousPayload.items.length > 0) {
    fs.writeFileSync("news.json", JSON.stringify(previousPayload), "utf8");
    console.log("Fallback to previous news.json");
  } else {
    fs.writeFileSync("news.json", JSON.stringify(payload), "utf8");
    console.log(`Saved ${finalItems.length} articles at ${payload.fullUpdatedAt}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
