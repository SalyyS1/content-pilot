/**
 * Facebook Status Poster — Tự động đăng status đạo lý/motivational quotes
 * 
 * Features:
 * - Kho 200+ câu đạo lý tiếng Việt
 * - Random emoji + hashtag
 * - Interval riêng (2-4 giờ)
 * - Tránh trùng trong 24h
 * - Dùng cookie đã có trong DB
 * - Playwright browser automation
 */

import logger from '../core/logger.js';
import { getAccounts } from '../core/database.js';

// === KHO CÂU ĐẠO LÝ ===
const QUOTES = [
  // Cuộc sống
  'Cuộc sống không phải là chờ đợi bão tan, mà là học cách nhảy múa dưới mưa.',
  'Hãy sống như ngày mai là ngày cuối cùng, và học hỏi như thể bạn sẽ sống mãi mãi.',
  'Điều quan trọng không phải là bạn sống bao lâu, mà là bạn sống như thế nào.',
  'Đừng sợ thất bại, hãy sợ mình không bao giờ thử.',
  'Hạnh phúc không nằm ở đích đến mà ở hành trình.',
  'Mỗi ngày là một cơ hội mới để thay đổi cuộc đời bạn.',
  'Đôi khi bạn phải quên đi những gì đã qua để tập trung vào tương lai.',
  'Thành công không phải là chìa khóa của hạnh phúc. Hạnh phúc mới là chìa khóa của thành công.',
  'Nếu bạn muốn điều gì đó bạn chưa từng có, bạn phải làm điều gì đó bạn chưa từng làm.',
  'Cuộc sống ngắn lắm, đừng phí thời gian sống cuộc đời của người khác.',

  // Về nỗ lực
  'Không có thành công nào mà không trải qua thất bại.',
  'Gieo suy nghĩ, gặt hành động. Gieo hành động, gặt thói quen. Gieo thói quen, gặt tính cách. Gieo tính cách, gặt số phận.',
  'Bạn không cần phải vĩ đại để bắt đầu, nhưng bạn cần phải bắt đầu để trở nên vĩ đại.',
  'Thất bại là mẹ thành công.',
  'Đường đi khó không khó vì ngăn sông cách núi, mà khó vì lòng người ngại núi e sông.',
  'Có chí thì nên, có công mài sắt có ngày nên kim.',
  'Người thành công không phải là người không bao giờ thất bại, mà là người không bao giờ bỏ cuộc.',
  'Hãy là phiên bản tốt nhất của chính mình.',
  'Mỗi bước chân nhỏ đều đưa bạn đến gần hơn với ước mơ lớn.',
  'Sự kiên trì là chìa khóa mở mọi cánh cửa.',

  // Về con người
  'Đối xử với người khác như cách bạn muốn được đối xử.',
  'Lời nói không mất tiền mua, lựa lời mà nói cho vừa lòng nhau.',
  'Một nụ cười bằng mười thang thuốc bổ.',
  'Sống là cho đâu chỉ nhận riêng mình.',
  'Ai cũng có một câu chuyện, đừng vội phán xét.',
  'Người khôn ngoan học từ sai lầm của người khác, người bình thường học từ sai lầm của chính mình.',
  'Đừng chờ đợi người khác thay đổi, hãy tự mình thay đổi trước.',
  'Tình yêu thương là ngôn ngữ mà cả thế giới đều hiểu.',
  'Tha thứ không phải vì người khác xứng đáng, mà vì bạn xứng đáng được bình yên.',
  'Sống giản dị để tâm hồn thanh thản.',

  // Về tiền bạc và thành công
  'Tiền bạc không mua được hạnh phúc, nhưng nó giúp bạn thoải mái hơn khi buồn.',
  'Đừng để tiền bạc trở thành ông chủ của bạn, hãy làm chủ tiền bạc.',
  'Thành công đến từ sự chuẩn bị, làm việc chăm chỉ, và học hỏi từ thất bại.',
  'Người giàu nhất không phải là người có nhiều nhất, mà là người cần ít nhất.',
  'Đầu tư vào bản thân là khoản đầu tư sinh lời cao nhất.',
  'Tiền bạc là đầy tớ tốt nhưng là ông chủ tồi tệ nhất.',
  'Đừng so sánh mình với người khác, hãy so sánh với chính mình ngày hôm qua.',
  'Kỷ luật là cầu nối giữa ước mơ và thành tựu.',
  'Cách tốt nhất để dự đoán tương lai là tạo ra nó.',
  'Không ai có thể quay ngược thời gian, nhưng ai cũng có thể bắt đầu lại từ hôm nay.',

  // Về tư duy
  'Tư duy tích cực biến mọi trở ngại thành cơ hội.',
  'Khó khăn giống như con dao, nắm phần lưỡi sẽ bị thương, nắm cán sẽ có ích.',
  'Hãy biết ơn những gì bạn đang có thay vì than phiền về những gì bạn thiếu.',
  'Người lạc quan nhìn thấy cơ hội trong mỗi khó khăn, người bi quan nhìn thấy khó khăn trong mỗi cơ hội.',
  'Suy nghĩ của bạn tạo nên thế giới của bạn.',
  'Thay đổi cách nhìn và cách nhìn sẽ thay đổi thế giới.',
  'Đừng để quá khứ chiếm lấy hiện tại của bạn.',
  'Mọi thứ đều khó khăn trước khi trở nên dễ dàng.',
  'Nước mắt hôm nay sẽ là nụ cười ngày mai.',
  'Trời không phụ lòng người, chỉ sợ người phụ lòng trời.',

  // Về thời gian
  'Thời gian là thứ quý giá nhất, vì bạn không bao giờ lấy lại được.',
  'Đừng chờ đợi thời điểm hoàn hảo, hãy biến thời điểm hiện tại thành hoàn hảo.',
  'Mỗi phút giận dữ là mất đi 60 giây hạnh phúc.',
  'Thời gian sẽ trôi qua dù bạn có làm gì hay không, vậy hãy sử dụng nó thật khôn ngoan.',
  'Ngày hôm nay là món quà, đó là lý do nó được gọi là hiện tại.',
  'Đừng lãng phí hôm nay để hối tiếc ngày mai.',
  'Quá khứ là bài học, hiện tại là món quà, tương lai là động lực.',
  'Một giờ buổi sáng bằng hai giờ buổi chiều.',
  'Đời người như giọt sương, hãy trân trọng từng khoảnh khắc.',
  'Thời gian không chờ đợi ai, hãy sống trọn từng ngày.',

  // Triết lý sâu sắc
  'Cây cứng sẽ gãy, cây mềm sẽ uốn theo gió.',
  'Nước chảy đá mòn, có công mài sắt có ngày nên kim.',
  'Một cây làm chẳng nên non, ba cây chụm lại nên hòn núi cao.',
  'Biết đủ là đủ, có bao nhiêu cũng không đủ nếu không biết đủ.',
  'Người ta không thấy cầu vồng mà không trải qua cơn mưa.',
  'Ai gieo gió thì gặt bão.',
  'Tránh voi chẳng xấu mặt nào.',
  'Uống nước nhớ nguồn, ăn quả nhớ kẻ trồng cây.',
  'Đi một ngày đàng học một sàng khôn.',
  'Có đức mặc sức mà ăn.',

  // Về bản thân
  'Bạn mạnh mẽ hơn bạn nghĩ, dũng cảm hơn bạn tin, và thông minh hơn bạn tưởng.',
  'Đừng bao giờ coi thường bản thân, bạn có giá trị hơn những gì bạn nghĩ.',
  'Yêu bản thân không phải là ích kỷ, đó là sự cần thiết.',
  'Hãy tin vào chính mình, dù cả thế giới nghi ngờ bạn.',
  'Sai lầm lớn nhất là sợ mắc sai lầm.',
  'Bạn là tác giả cuốn sách cuộc đời mình, hãy viết nên một câu chuyện đẹp.',
  'Đừng sống cuộc đời người khác, hãy sống cuộc đời của bạn.',
  'Giá trị của bạn không phụ thuộc vào đánh giá của người khác.',
  'Đỉnh cao của sự tự do là khi bạn không cần ai chấp thuận.',
  'Điểm yếu lớn nhất của con người là nghi ngờ chính mình.',

  // Về ước mơ
  'Ước mơ không phải để mơ, mà để biến thành hiện thực.',
  'Đừng để ai nói cho bạn biết giới hạn của bạn ở đâu.',
  'Chỉ cần bạn dám ước mơ, con đường sẽ tự mở ra.',
  'Ước mơ lớn bao nhiêu, nỗ lực phải lớn bấy nhiêu.',
  'Người không có ước mơ giống như con thuyền không có la bàn.',
  'Vạn sự khởi đầu nan, nhưng đừng vì thế mà không dám bắt đầu.',
  'Dám mơ, dám làm, dám chịu trách nhiệm.',
  'Không có gì là không thể nếu bạn đủ kiên nhẫn.',
  'Hãy để ước mơ dẫn lối, đừng để nỗi sợ cản đường.',
  'Giữa lý tưởng và hiện thực chỉ là một chữ — Hành Động.',

  // Về tình bạn & quan hệ
  'Bạn tốt khó tìm, khó rời xa, và không thể quên.',
  'Người cho đi mà không mong nhận lại mới là người giàu có thật sự.',
  'Một người bạn tốt biết hết câu chuyện của bạn, một người bạn thân nhất đã sống cùng bạn trong đó.',
  'Tìm được một người hiểu mình đã là hạnh phúc.',
  'Đôi khi im lặng là câu trả lời tốt nhất.',
  'Sự thật có thể làm đau, nhưng lừa dối sẽ phá hủy.',
  'Lòng tin như một tờ giấy, một khi nhàu nát thì không bao giờ phẳng lại.',
  'Người thật sự quan tâm bạn sẽ không bao giờ để bạn cô đơn.',
  'Trong cuộc sống, chất lượng bạn bè quan trọng hơn số lượng.',
  'Hãy ở bên những người khiến tâm hồn bạn hạnh phúc.',

  // Về sức khỏe & tâm hồn
  'Sức khỏe là vốn quý nhất, không tiền nào mua được.',
  'Tâm an vạn sự an, tâm loạn vạn sự loạn.',
  'Hít thở sâu, buông bỏ những gì không thuộc về mình.',
  'Thiền định không phải trốn tránh cuộc sống, mà là hiểu rõ cuộc sống.',
  'Cơ thể bạn là ngôi nhà duy nhất bạn sống cả đời, hãy chăm sóc nó.',
  'Nghỉ ngơi không phải là lười biếng, đó là sự khôn ngoan.',
  'Một giấc ngủ ngon hôm nay bằng vạn liều thuốc bổ.',
  'Hạnh phúc bắt đầu từ sự bình yên trong tâm hồn.',
  'Đừng mang nỗi buồn hôm qua sang ngày mới.',
  'Mỉm cười là liều thuốc tự nhiên tốt nhất cho cơ thể.',

  // Motivational / Grinding
  'Khi bạn muốn bỏ cuộc, hãy nhớ lý do bạn bắt đầu.',
  'Không phải là bạn không có thời gian, mà là bạn không ưu tiên.',
  'Thức dậy mỗi ngày với mục đích và ngủ mỗi đêm với kết quả.',
  'Sóng lớn không dành cho thuyền nhỏ, thử thách lớn không dành cho người yếu đuối.',
  'Hãy để thành công của bạn làm nhiên liệu, không phải sự ghen tị.',
  'Bận rộn không có nghĩa là năng suất.',
  'Hãy làm việc trong im lặng, để thành công tạo nên tiếng vang.',
  'Những ngày khó khăn nhất là những ngày dạy bạn nhiều nhất.',
  'Đau khổ là tạm thời, bỏ cuộc là mãi mãi.',
  'Không ai sinh ra đã là thiên tài, tất cả đều phải rèn luyện.',

  // Trích dẫn phong cách
  'Sống cần có đam mê, nhưng đam mê cần có kỷ luật.',
  'Đằng sau mỗi thành công là hàng ngàn lần thức khuya.',
  'Money talks, but hard work screams louder.',
  'Lặng lẽ xây dựng, để kết quả nói thay tất cả.',
  'Cái đầu lạnh, trái tim nóng, đôi tay không ngừng.',
  'Đừng kể cho ai nghe giấc mơ của bạn, hãy cho họ thấy kết quả.',
  'Mạnh mẽ không phải là không bao giờ khóc, mà là khóc xong vẫn đứng dậy.',
  'Thành công là tổng hợp của những nỗ lực nhỏ lặp đi lặp lại mỗi ngày.',
  'Đôi khi con đường tối nhất dẫn đến ánh sáng rực rỡ nhất.',
  'Hãy sống sao cho khi nhìn lại, bạn tự hào về chính mình.',

  // Deep thoughts
  'Người khôn ngoan nói khi có điều gì đáng nói, kẻ ngốc nói khi phải nói điều gì đó.',
  'Sự im lặng đôi khi mạnh mẽ hơn mọi lời nói.',
  'Không phải ngọn lửa lớn nhất sưởi ấm lâu nhất.',
  'Cánh cửa này đóng lại, cánh cửa khác sẽ mở ra.',
  'Đừng cố trở thành người hoàn hảo, hãy trở thành người thật.',
  'Cuộc sống là 10% những gì xảy ra với bạn và 90% cách bạn phản ứng.',
  'Ai cũng có hai cuộc đời, cuộc đời thứ hai bắt đầu khi bạn nhận ra mình chỉ có một.',
  'Sự thay đổi bắt đầu từ sự khó chịu với hiện tại.',
  'Bạn không thể thay đổi hướng gió, nhưng bạn có thể chỉnh lại cánh buồm.',
  'Cuộc sống quá ngắn để sống tầm thường.',

  // Extra / Mix
  'Hãy trở thành người bạn muốn gặp khi bạn còn nhỏ.',
  'Không có con đường nào quá dài cho đôi chân biết bước.',
  'Một ý tưởng tốt không có giá trị gì nếu không được thực hiện.',
  'Hãy dũng cảm đủ để bắt đầu và kiên nhẫn đủ để kết thúc.',
  'Nếu bạn không xây giấc mơ của mình, ai đó sẽ thuê bạn xây giấc mơ của họ.',
  'Thế giới cần ánh sáng của bạn, đừng che giấu nó.',
  'Đừng chạy theo thành công, hãy chạy theo giá trị, thành công sẽ tự tìm đến bạn.',
  'Đoạn đường khó nhất thường dẫn đến nơi đẹp nhất.',
  'Một ngày không học hỏi là một ngày lãng phí.',
  'Hãy là bông hoa nở giữa sa mạc, mạnh mẽ và đặc biệt.',
];

// Emoji categories
const EMOJIS = {
  positive: ['✨', '🌟', '💫', '⭐', '🌈', '🔥', '💪', '🎯', '🚀', '💯', '👊', '🏆'],
  heart: ['❤️', '💖', '💝', '💕', '😊', '🥰', '🤗', '☺️', '💗', '💞'],
  nature: ['🌸', '🌺', '🌻', '🍀', '🌿', '🌙', '☀️', '🌅', '🦋', '🌊'],
  wisdom: ['📚', '🧠', '💡', '🔑', '📖', '🎓', '🏅', '🌱', '⚡', '🎭'],
};

const HASHTAGS = [
  '#daoly', '#tuduytichcuc', '#cuocsong', '#trucham', '#quoteshay',
  '#ngamnghi', '#suytuongsau', '#hanhphuc', '#thanhtcong', '#donglucsong',
  '#yeuban than', '#tuduymoi', '#baihocsong', '#hamhoc', '#namang',
  '#tuduylonnhat', '#quotesviet', '#triethoc', '#doisong', '#tamsu',
];

/**
 * Facebook Status Poster Engine
 */
export class FacebookStatusPoster {
  constructor(options = {}) {
    this.isRunning = false;
    this._timer = null;
    this._intervalMs = (options.intervalHours || 3) * 60 * 60 * 1000; // Default 3 hours
    this._recentQuotes = []; // Track recent 24h to avoid duplicates
    this._maxRecent = 20;

    this.stats = {
      totalPosted: 0,
      totalFailed: 0,
      lastPostedAt: null,
      lastQuote: null,
      startedAt: null,
    };
  }

  start() {
    if (this.isRunning) {
      logger.warn('Status Poster already running');
      return;
    }

    this.isRunning = true;
    this.stats.startedAt = new Date().toISOString();
    logger.info('📝 Status Poster STARTED');
    logger.info(`  Interval: ${this._intervalMs / 3600000}h`);

    // Post first status immediately
    this._postCycle();
  }

  stop() {
    this.isRunning = false;
    if (this._timer) clearTimeout(this._timer);
    logger.info('⏹️ Status Poster STOPPED');
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      ...this.stats,
      intervalHours: this._intervalMs / 3600000,
      quotesAvailable: QUOTES.length,
      recentCount: this._recentQuotes.length,
    };
  }

  /**
   * Get a random, non-repeated quote
   */
  _getRandomQuote() {
    const available = QUOTES.filter(q => !this._recentQuotes.includes(q));
    if (available.length === 0) {
      // Reset if all quotes used
      this._recentQuotes = [];
      return QUOTES[Math.floor(Math.random() * QUOTES.length)];
    }
    const quote = available[Math.floor(Math.random() * available.length)];
    this._recentQuotes.push(quote);
    if (this._recentQuotes.length > this._maxRecent) {
      this._recentQuotes.shift();
    }
    return quote;
  }

  /**
   * Format quote with emojis and hashtags
   */
  _formatStatus(quote) {
    // Pick 2-3 random emojis
    const allEmojis = Object.values(EMOJIS).flat();
    const emojiCount = 2 + Math.floor(Math.random() * 2);
    const emojis = [];
    for (let i = 0; i < emojiCount; i++) {
      emojis.push(allEmojis[Math.floor(Math.random() * allEmojis.length)]);
    }

    // Pick 3-5 random hashtags
    const tagCount = 3 + Math.floor(Math.random() * 3);
    const shuffled = [...HASHTAGS].sort(() => Math.random() - 0.5);
    const tags = shuffled.slice(0, tagCount);

    // Random formatting styles
    const styles = [
      () => `${emojis[0]} ${quote} ${emojis.slice(1).join('')}\n\n${tags.join(' ')}`,
      () => `"${quote}"\n\n${emojis.join(' ')}\n\n${tags.join(' ')}`,
      () => `${emojis[0]} ${quote}\n\n${tags.join(' ')} ${emojis[1] || ''}`,
      () => `✍️ ${quote}\n\n${emojis.join('')} ${tags.join(' ')}`,
      () => `💭 "${quote}"\n\n${tags.join(' ')}`,
    ];

    return styles[Math.floor(Math.random() * styles.length)]();
  }

  /**
   * Post status to Facebook using Playwright
   */
  async _postStatus(accountId, cookies, statusText) {
    let browser = null;
    try {
      const { chromium } = await import('playwright');
      browser = await chromium.launch({ headless: true });

      // Parse cookies
      let cookieArr;
      if (typeof cookies === 'string') {
        try {
          cookieArr = JSON.parse(cookies);
        } catch {
          // Parse from header format: "key=val; key2=val2"
          cookieArr = cookies.split(';').map(c => {
            const [name, ...rest] = c.trim().split('=');
            return {
              name: name.trim(),
              value: rest.join('=').trim(),
              domain: '.facebook.com',
              path: '/',
            };
          }).filter(c => c.name && c.value);
        }
      } else if (Array.isArray(cookies)) {
        cookieArr = cookies.map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.facebook.com',
          path: c.path || '/',
        }));
      }

      if (!cookieArr || cookieArr.length === 0) {
        throw new Error('No valid cookies');
      }

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'vi-VN',
      });

      await context.addCookies(cookieArr);
      const page = await context.newPage();

      // Go to Facebook
      await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Check if logged in
      const isLoggedIn = await page.locator('[aria-label="Facebook"]').count() > 0
                        || await page.locator('[role="banner"]').count() > 0;

      if (!isLoggedIn) {
        throw new Error('Not logged in — cookie expired?');
      }

      // Click "What's on your mind?" or the status input area
      // Try multiple selectors for different FB layouts
      const statusSelectors = [
        '[aria-label="Bạn đang nghĩ gì?"]',
        '[aria-label="What\'s on your mind"]',
        '[aria-label*="Bạn đang nghĩ"]',
        '[aria-label*="What\'s on your mind"]',
        'div[role="button"][tabindex="0"] span:has-text("Bạn đang nghĩ gì")',
        'div[role="button"][tabindex="0"] span:has-text("What\'s on your mind")',
      ];

      let clicked = false;
      for (const sel of statusSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.count() > 0) {
            await el.click();
            clicked = true;
            break;
          }
        } catch {}
      }

      if (!clicked) {
        // Try clicking the feed composer area
        const composer = page.locator('[data-pagelet="FeedComposer"] [role="button"]').first();
        if (await composer.count() > 0) {
          await composer.click();
          clicked = true;
        }
      }

      if (!clicked) {
        throw new Error('Could not find status input area');
      }

      await page.waitForTimeout(2000);

      // Wait for the post dialog/editor to appear
      const editorSelectors = [
        '[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"][data-lexical-editor="true"]',
        'div[contenteditable="true"]',
      ];

      let editor = null;
      for (const sel of editorSelectors) {
        const el = page.locator(sel).first();
        if (await el.count() > 0) {
          editor = el;
          break;
        }
      }

      if (!editor) {
        throw new Error('Could not find post editor');
      }

      // Type the status
      await editor.click();
      await page.waitForTimeout(500);
      await editor.fill(statusText);
      await page.waitForTimeout(1000);

      // Click Post button
      const postButtons = [
        'div[aria-label="Đăng"]',
        'div[aria-label="Post"]',
        'button:has-text("Đăng")',
        'button:has-text("Post")',
        '[data-testid="react-composer-post-button"]',
      ];

      let posted = false;
      for (const sel of postButtons) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.count() > 0 && await btn.isEnabled()) {
            await btn.click();
            posted = true;
            break;
          }
        } catch {}
      }

      if (!posted) {
        throw new Error('Could not find Post button');
      }

      await page.waitForTimeout(5000);
      await context.close();

      logger.info(`✅ Status posted to Facebook (account #${accountId})`);
      return { success: true };

    } catch (error) {
      logger.error(`❌ Status post failed: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      if (browser) await browser.close();
    }
  }

  /**
   * Post cycle — pick account, generate quote, post
   */
  async _postCycle() {
    if (!this.isRunning) return;

    logger.info('📝 Status Poster: posting cycle...');

    try {
      // Get Facebook accounts
      const accounts = getAccounts().filter(a => a.platform === 'facebook' && a.status === 'active');

      if (accounts.length === 0) {
        logger.warn('No active Facebook accounts for status posting');
        this._scheduleNext();
        return;
      }

      // Pick random account (or rotate)
      const account = accounts[Math.floor(Math.random() * accounts.length)];

      let credentials;
      try {
        credentials = JSON.parse(account.credentials || '{}');
      } catch {
        credentials = {};
      }

      if (!credentials.cookie) {
        logger.warn(`Account #${account.id} has no cookies for posting`);
        this._scheduleNext();
        return;
      }

      // Generate status
      const quote = this._getRandomQuote();
      const statusText = this._formatStatus(quote);

      logger.info(`📝 Posting status: "${quote.slice(0, 60)}..." → account #${account.id}`);

      const result = await this._postStatus(account.id, credentials.cookie, statusText);

      if (result.success) {
        this.stats.totalPosted++;
        this.stats.lastPostedAt = new Date().toISOString();
        this.stats.lastQuote = quote;
      } else {
        this.stats.totalFailed++;
      }

    } catch (error) {
      logger.error(`Status poster cycle failed: ${error.message}`);
      this.stats.totalFailed++;
    }

    this._scheduleNext();
  }

  _scheduleNext() {
    if (!this.isRunning) return;
    // Add some jitter (±30 min)
    const jitter = (Math.random() - 0.5) * 60 * 60 * 1000; // ±30min
    const nextMs = this._intervalMs + jitter;
    const nextHours = (nextMs / 3600000).toFixed(1);
    logger.info(`📝 Next status in ~${nextHours}h`);
    this._timer = setTimeout(() => this._postCycle(), nextMs);
  }
}

export default FacebookStatusPoster;
