/**
 * @author Saviio
 * @since 2020-4-19
 */

// https://developer.mozilla.org/en-US/docs/Web/API/CSSRule
enum RuleType {
  // type: rule will be rewrote 规则会被重写
  /**
   * 样式规则
   *    h1 { 
   *        color: pink; 
   *    }
   */
  STYLE = 1,

  /**
   * 媒体规则
   *   @media (min-width: 500px) { 
   *      body { 
   *        color: blue;
   *      } 
   *   }
   */
  MEDIA = 4,

  /**
   * supports规则  
   * @supports (display: grid) {
   *    body { 
   *      color: blue;
   *    } 
   * }
   */
  SUPPORTS = 12,

  // type: value will be kept 规则会被保持
  /**
   * 导入规则  
   * @import url("style.css") screen;
   */

  IMPORT = 3,

  /**
   * 字体规则
   * @font-face { 
   *    font-family: MyHelvetica; 
   *    src: local("Helvetica Neue Bold"), 
   *         local("HelveticaNeue-Bold"),
   *         url(MgOpenModernaBold.ttf);
   *    font-weight: bold;
   * }
   */
  FONT_FACE = 5,

  /**
   * 单个CSS@page规则
   *  @page { 
   *    margin: 1cm;
   *  }
   */
  PAGE = 6,

  /**
   * CSS动画的一组完整关键帧的对象 
   * @keyframes slidein {
   *    from {
   *       transform: translateX(0%);
   *     }
   *     to {
   *       transform: translateX(100%);
   *     }
   *   }
   */
  KEYFRAMES = 7,

  /**
   * 给定关键帧的一组样式的对象
   * @keyframes slidein {
      from {
        transform: translateX(0%);
      }

      to {
        transform: translateX(100%);
      }
    }
   */
  KEYFRAME = 8,
}

const arrayify = <T>(list: CSSRuleList | any[]) => {
  return [].slice.call(list, 0) as T[];
};

const rawDocumentBodyAppend = HTMLBodyElement.prototype.appendChild;

export class ScopedCSS {
  private static ModifiedTag = 'Symbol(style-modified-qiankun)';

  private sheet: StyleSheet;

  private swapNode: HTMLStyleElement;

  constructor() {
    /**
     * 创建一个style元素节点
     * 将该元素append到body下
     * 将元素节点赋值给变量swapNode，并设置为禁用
     */
    const styleNode = document.createElement('style');
    rawDocumentBodyAppend.call(document.body, styleNode);

    this.swapNode = styleNode;
    this.sheet = styleNode.sheet!;
    this.sheet.disabled = true;
  }

  process(styleNode: HTMLStyleElement, prefix: string = '') {
    // style标签中有css文字内容
    if (styleNode.textContent !== '') {
      // 基于该内容临时创建一个文本节点
      const textNode = document.createTextNode(styleNode.textContent || '');
      // 临时节点append到私有变量swapNode下
      this.swapNode.appendChild(textNode);
      const sheet = this.swapNode.sheet as any; // type is missing  //获取到swapNode的样式表
      const rules = arrayify<CSSRule>(sheet?.cssRules ?? []);  //获取到样式表的cssRules 样式规则
      const css = this.rewrite(rules, prefix); //重写样式规则
      // eslint-disable-next-line no-param-reassign
      styleNode.textContent = css;

      // cleanup 移除临时文本节点
      this.swapNode.removeChild(textNode);
      return;
    }

    // 监听dom结构变化
    const mutator = new MutationObserver((mutations) => {
      //节点发生变化时会执行此回调
      for (let i = 0; i < mutations.length; i += 1) {
        const mutation = mutations[i];

        if (ScopedCSS.ModifiedTag in styleNode) {
          return;
        }

        if (mutation.type === 'childList') {
          // 修改css选择器
          const sheet = styleNode.sheet as any;
          const rules = arrayify<CSSRule>(sheet?.cssRules ?? []);
          const css = this.rewrite(rules, prefix);

          // eslint-disable-next-line no-param-reassign
          styleNode.textContent = css;
          // eslint-disable-next-line no-param-reassign
          (styleNode as any)[ScopedCSS.ModifiedTag] = true; //给该样式节点打上已修改的标记
        }
      }
    });

    // since observer will be deleted when node be removed 因为在删除节点时，观察者将被删除
    // we dont need create a cleanup function manually 我们不需要手动创建清理函数
    // see https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/disconnect
    // 观察目标节点styleNode及其子节点
    mutator.observe(styleNode, { childList: true });
  }

  private rewrite(rules: CSSRule[], prefix: string = '') {
    let css = '';

    rules.forEach((rule) => {
      switch (rule.type) {
        case RuleType.STYLE:
          css += this.ruleStyle(rule as CSSStyleRule, prefix);
          break;
        case RuleType.MEDIA:
          css += this.ruleMedia(rule as CSSMediaRule, prefix);
          break;
        case RuleType.SUPPORTS:
          css += this.ruleSupport(rule as CSSSupportsRule, prefix);
          break;
        default:
          css += `${rule.cssText}`;
          break;
      }
    });

    return css;
  }

  // handle case:
  // .app-main {}
  // html, body {}

  // eslint-disable-next-line class-methods-use-this
  private ruleStyle(rule: CSSStyleRule, prefix: string) {
    const rootSelectorRE = /((?:[^\w\-.#]|^)(body|html|:root))/gm; // 匹配根选择器：body | html | :root 和[A-Z0-9_-.#]开头 + (body|html|:root)
    const rootCombinationRE = /(html[^\w{[]+)/gm; // 匹配根组合选择器

    const selector = rule.selectorText.trim(); //css选择器  #icon-svg-algorithm .cls-1
    let { cssText } = rule; // cssText 为 选择器及一整块内容  #icon-svg-algorithm .cls-1 {opacity:0;}
    // handle html { ... }
    // handle body { ... }
    // handle :root { ... }
    if (selector === 'html' || selector === 'body' || selector === ':root') {
      return cssText.replace(rootSelectorRE, prefix);
    }

    // handle html body { ... }
    // handle html > body { ... }
    if (rootCombinationRE.test(rule.selectorText)) {
      const siblingSelectorRE = /(html[^\w{]+)(\+|~)/gm;

      // since html + body is a non-standard rule for html transformer will ignore it
      //【翻译】因为html+body是html转换器的非标准规则，所以它将被忽略

      if (!siblingSelectorRE.test(rule.selectorText)) {
        cssText = cssText.replace(rootCombinationRE, '');
      }
    }

    // handle grouping selector, a,span,p,div { ... }
    cssText = cssText.replace(/^[\s\S]+{/, (selectors) =>
      selectors.replace(/(^|,\n?)([^,]+)/g, (item, p, s) => {
        // handle div,body,span { ... }
        if (rootSelectorRE.test(item)) {
          return item.replace(rootSelectorRE, (m) => {
            // do not discard valid previous character, such as body,html or *:not(:root)
            const whitePrevChars = [',', '('];

            if (m && whitePrevChars.includes(m[0])) {
              return `${m[0]}${prefix}`;
            }

            // replace root selector with prefix
            return prefix;
          });
        }

        return `${p}${prefix} ${s.replace(/^ */, '')}`;
      }),
    );

    return cssText;
  }

  // handle case:
  // @media screen and (max-width: 300px) {}
  private ruleMedia(rule: CSSMediaRule, prefix: string) {
    const css = this.rewrite(arrayify(rule.cssRules), prefix);
    return `@media ${rule.conditionText} {${css}}`;
  }

  // handle case:
  // @supports (display: grid) {}
  private ruleSupport(rule: CSSSupportsRule, prefix: string) {
    const css = this.rewrite(arrayify(rule.cssRules), prefix);
    return `@supports ${rule.conditionText} {${css}}`;
  }
}

// 处理器
let processor: ScopedCSS;

export const QiankunCSSRewriteAttr = 'data-qiankun';
export const process = (
  appWrapper: HTMLElement,
  stylesheetElement: HTMLStyleElement | HTMLLinkElement,
  appName: string,
): void => {
  // lazy singleton pattern 只实例化一个singleton
  if (!processor) {
    processor = new ScopedCSS();
  }

  // 实验性样式隔离不支持link元素
  if (stylesheetElement.tagName === 'LINK') {
    console.warn('Feature: sandbox.experimentalStyleIsolation is not support for link element yet.');
  }

  // 挂载的dom为传入的dom节点容器
  const mountDOM = appWrapper;
  if (!mountDOM) {
    return;
  }

  const tag = (mountDOM.tagName || '').toLowerCase();

  if (tag && stylesheetElement.tagName === 'STYLE') {
    //例：div[data-qiankun=nlpweb]
    const prefix = `${tag}[${QiankunCSSRewriteAttr}="${appName}"]`;
    processor.process(stylesheetElement, prefix);
  }
};
