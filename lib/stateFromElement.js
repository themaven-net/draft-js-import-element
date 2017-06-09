'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

exports.default = stateFromElement;

var _replaceTextWithMeta3 = require('./lib/replaceTextWithMeta');

var _replaceTextWithMeta4 = _interopRequireDefault(_replaceTextWithMeta3);

var _draftJs = require('draft-js');

var _immutable = require('immutable');

var _draftJsUtils = require('draft-js-utils');

var _syntheticDom = require('synthetic-dom');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

// A ParsedBlock has two purposes:
//   1) to keep data about the block (textFragments, type)
//   2) to act as some context for storing parser state as we parse its contents
var NO_STYLE = (0, _immutable.OrderedSet)();
var NO_ENTITY = null;

var EMPTY_BLOCK = new _draftJs.ContentBlock({
  key: (0, _draftJs.genKey)(),
  text: '',
  type: _draftJsUtils.BLOCK_TYPE.UNSTYLED,
  characterList: (0, _immutable.List)(),
  depth: 0
});

var LINE_BREAKS = /(\r\n|\r|\n)/g;
// We use `\r` because that character is always stripped from source (normalized
// to `\n`), so it's safe to assume it will only appear in the text content when
// we put it there as a placeholder.
var SOFT_BREAK_PLACEHOLDER = '\r';
var ZERO_WIDTH_SPACE = '\u200B';
var DATA_ATTRIBUTE = /^data-([a-z0-9-]+)$/;

// Map element attributes to entity data.
var ELEM_ATTR_MAP = {
  a: { href: 'url', rel: 'rel', target: 'target', title: 'title' },
  img: { src: 'src', alt: 'alt' }
};

var getEntityData = function getEntityData(tagName, element) {
  var data = {};
  if (ELEM_ATTR_MAP.hasOwnProperty(tagName)) {
    var attrMap = ELEM_ATTR_MAP[tagName];
    for (var i = 0; i < element.attributes.length; i++) {
      var _element$attributes$i = element.attributes[i],
          name = _element$attributes$i.name,
          value = _element$attributes$i.value;

      if (value != null) {
        if (attrMap.hasOwnProperty(name)) {
          var newName = attrMap[name];
          data[newName] = value;
        } else if (DATA_ATTRIBUTE.test(name)) {
          data[name] = value;
        }
      }
    }
  }
  return data;
};

// Functions to convert elements to entities.
var ELEM_TO_ENTITY = {
  a: function a(tagName, element) {
    var data = getEntityData(tagName, element);
    // Don't add `<a>` elements with no href.
    if (data.url != null) {
      return _draftJs.Entity.create(_draftJsUtils.ENTITY_TYPE.LINK, 'MUTABLE', data);
    }
  },
  img: function img(tagName, element) {
    var data = getEntityData(tagName, element);
    // Don't add `<img>` elements with no src.
    if (data.src != null) {
      return _draftJs.Entity.create(_draftJsUtils.ENTITY_TYPE.IMAGE, 'MUTABLE', data);
    }
  }
};

// TODO: Move this out to a module.
var INLINE_ELEMENTS = {
  a: 1, abbr: 1, area: 1, audio: 1, b: 1, bdi: 1, bdo: 1, br: 1, button: 1,
  canvas: 1, cite: 1, code: 1, command: 1, datalist: 1, del: 1, dfn: 1, em: 1,
  embed: 1, i: 1, iframe: 1, img: 1, input: 1, ins: 1, kbd: 1, keygen: 1,
  label: 1, map: 1, mark: 1, meter: 1, noscript: 1, object: 1, output: 1,
  progress: 1, q: 1, ruby: 1, s: 1, samp: 1, script: 1, select: 1, small: 1,
  span: 1, strong: 1, sub: 1, sup: 1, textarea: 1, time: 1, u: 1, var: 1,
  video: 1, wbr: 1, acronym: 1, applet: 1, basefont: 1, big: 1, font: 1,
  isindex: 1, strike: 1, style: 1, tt: 1
};

// These elements are special because they cannot contain text as a direct
// child (some cannot contain childNodes at all).
var SPECIAL_ELEMENTS = {
  area: 1, base: 1, br: 1, col: 1, colgroup: 1, command: 1, dl: 1, embed: 1,
  head: 1, hgroup: 1, hr: 1, iframe: 1, img: 1, input: 1, keygen: 1, link: 1,
  meta: 1, ol: 1, optgroup: 1, option: 1, param: 1, script: 1, select: 1,
  source: 1, style: 1, table: 1, tbody: 1, textarea: 1, tfoot: 1, thead: 1,
  title: 1, tr: 1, track: 1, ul: 1, wbr: 1, basefont: 1, dialog: 1, dir: 1,
  isindex: 1
};

// These blocks do not contain other blocks
var BLOCK_NO_BLOCKS = {
  blockquote: 1

  // These elements are special because they cannot contain childNodes.
};var SELF_CLOSING_ELEMENTS = { img: 1 };

var BlockGenerator = function () {
  function BlockGenerator() {
    var options = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

    _classCallCheck(this, BlockGenerator);

    this.options = options;
    // This represents the hierarchy as we traverse nested elements; for
    // example [body, ul, li] where we must know li's parent type (ul or ol).
    this.blockStack = [];
    // This is a linear list of blocks that will form the output; for example
    // [p, li, li, blockquote].
    this.blockList = [];
    this.depth = 0;
  }

  _createClass(BlockGenerator, [{
    key: 'process',
    value: function process(element) {
      this.processBlockElement(element);
      var contentBlocks = [];
      this.blockList.forEach(function (block) {
        var _concatFragments = concatFragments(block.textFragments),
            text = _concatFragments.text,
            characterMeta = _concatFragments.characterMeta;

        var includeEmptyBlock = false;
        // If the block contains only a soft break then don't discard the block,
        // but discard the soft break.
        if (text === SOFT_BREAK_PLACEHOLDER) {
          includeEmptyBlock = true;
          text = '';
        }
        if (block.tagName === 'pre') {
          var _trimLeadingNewline = trimLeadingNewline(text, characterMeta);

          text = _trimLeadingNewline.text;
          characterMeta = _trimLeadingNewline.characterMeta;
        } else {
          var _collapseWhiteSpace = collapseWhiteSpace(text, characterMeta);

          text = _collapseWhiteSpace.text;
          characterMeta = _collapseWhiteSpace.characterMeta;
        }
        // Previously we were using a placeholder for soft breaks. Now that we
        // have collapsed whitespace we can change it back to normal line breaks.
        text = text.split(SOFT_BREAK_PLACEHOLDER).join('\n');
        // Discard empty blocks (unless otherwise specified).
        if (text.length || includeEmptyBlock) {
          contentBlocks.push(new _draftJs.ContentBlock({
            key: (0, _draftJs.genKey)(),
            text: text,
            type: block.type,
            characterList: characterMeta.toList(),
            depth: block.depth,
            data: block.data ? (0, _immutable.Map)(block.data) : (0, _immutable.Map)()
          }));
        }
      });
      if (contentBlocks.length) {
        return contentBlocks;
      } else {
        return [EMPTY_BLOCK];
      }
    }
  }, {
    key: 'getBlockTypeFromTagName',
    value: function getBlockTypeFromTagName(tagName) {
      var blockTypes = this.options.blockTypes;

      if (blockTypes && blockTypes[tagName]) {
        return blockTypes[tagName];
      }
      switch (tagName) {
        case 'li':
          {
            var parent = this.blockStack.slice(-1)[0];
            return parent.tagName === 'ol' ? _draftJsUtils.BLOCK_TYPE.ORDERED_LIST_ITEM : _draftJsUtils.BLOCK_TYPE.UNORDERED_LIST_ITEM;
          }
        case 'blockquote':
          {
            return _draftJsUtils.BLOCK_TYPE.BLOCKQUOTE;
          }
        case 'h1':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_ONE;
          }
        case 'h2':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_TWO;
          }
        case 'h3':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_THREE;
          }
        case 'h4':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_FOUR;
          }
        case 'h5':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_FIVE;
          }
        case 'h6':
          {
            return _draftJsUtils.BLOCK_TYPE.HEADER_SIX;
          }
        case 'pre':
          {
            return _draftJsUtils.BLOCK_TYPE.CODE;
          }
        case 'img':
        case 'figure':
          {
            return _draftJsUtils.BLOCK_TYPE.ATOMIC;
          }
        default:
          {
            return _draftJsUtils.BLOCK_TYPE.UNSTYLED;
          }
      }
    }
  }, {
    key: 'processBlockElement',
    value: function processBlockElement(element) {
      if (!element) {
        return;
      }
      var customBlockFn = this.options.customBlockFn;

      var tagName = element.nodeName.toLowerCase();
      var type = void 0;
      var data = void 0;
      if (customBlockFn) {
        var customBlock = customBlockFn(element);
        if (customBlock != null) {
          type = customBlock.type;
          data = customBlock.data;
        }
      }
      if (type == null) {
        type = this.getBlockTypeFromTagName(tagName);
      }
      var hasDepth = canHaveDepth(type);
      var allowRender = !SPECIAL_ELEMENTS.hasOwnProperty(tagName);
      var block = {
        tagName: tagName,
        textFragments: [],
        type: type,
        styleStack: [NO_STYLE],
        entityStack: [NO_ENTITY],
        depth: hasDepth ? this.depth : 0,
        data: data
      };
      if (allowRender) {
        this.blockList.push(block);
        if (hasDepth) {
          this.depth += 1;
        }
      }
      var parentBlock = this.blockStack.slice(-1)[0];
      var validBlock = parentBlock === undefined || !BLOCK_NO_BLOCKS[parentBlock.tagName];
      if (validBlock) {
        this.blockStack.push(block);
      }
      if (element.childNodes != null) {
        Array.from(element.childNodes).forEach(this.processNode, this);
      }
      if (validBlock) {
        this.blockStack.pop();
      }
      if (allowRender && hasDepth) {
        this.depth -= 1;
      }
    }
  }, {
    key: 'processInlineElement',
    value: function processInlineElement(element) {
      var tagName = element.nodeName.toLowerCase();
      if (tagName === 'br') {
        this.processText(SOFT_BREAK_PLACEHOLDER);
        return;
      }
      var block = this.blockStack.slice(-1)[0];
      var style = block.styleStack.slice(-1)[0];
      var entityKey = block.entityStack.slice(-1)[0];
      style = addStyleFromTagName(style, tagName, this.options.elementStyles);
      if (ELEM_TO_ENTITY.hasOwnProperty(tagName)) {
        // If the to-entity function returns nothing, use the existing entity.
        entityKey = ELEM_TO_ENTITY[tagName](tagName, element) || entityKey;
      }
      block.styleStack.push(style);
      block.entityStack.push(entityKey);
      if (element.childNodes != null) {
        Array.from(element.childNodes).forEach(this.processNode, this);
      }
      if (SELF_CLOSING_ELEMENTS.hasOwnProperty(tagName)) {
        this.processText('\xA0');
      }
      block.entityStack.pop();
      block.styleStack.pop();
    }
  }, {
    key: 'processTextNode',
    value: function processTextNode(node) {
      var text = node.nodeValue;
      // This is important because we will use \r as a placeholder for a soft break.
      text = text.replace(LINE_BREAKS, '\n');
      // Replace zero-width space (we use it as a placeholder in markdown) with a
      // soft break.
      // TODO: The import-markdown package should correctly turn breaks into <br>
      // elements so we don't need to include this hack.
      text = text.split(ZERO_WIDTH_SPACE).join(SOFT_BREAK_PLACEHOLDER);
      this.processText(text);
    }
  }, {
    key: 'processText',
    value: function processText(text) {
      var block = this.blockStack.slice(-1)[0];
      var style = block.styleStack.slice(-1)[0];
      var entity = block.entityStack.slice(-1)[0];
      var charMetadata = _draftJs.CharacterMetadata.create({
        style: style,
        entity: entity
      });
      var seq = (0, _immutable.Repeat)(charMetadata, text.length);
      block.textFragments.push({
        text: text,
        characterMeta: seq
      });
    }
  }, {
    key: 'processNode',
    value: function processNode(node) {
      if (node.nodeType === _syntheticDom.NODE_TYPE_ELEMENT) {
        var _element = node;
        var _tagName = _element.nodeName.toLowerCase();
        if (INLINE_ELEMENTS.hasOwnProperty(_tagName)) {
          this.processInlineElement(_element);
        } else {
          this.processBlockElement(_element);
        }
      } else if (node.nodeType === _syntheticDom.NODE_TYPE_TEXT) {
        this.processTextNode(node);
      }
    }
  }]);

  return BlockGenerator;
}();

function trimLeadingNewline(text, characterMeta) {
  if (text.charAt(0) === '\n') {
    text = text.slice(1);
    characterMeta = characterMeta.slice(1);
  }
  return { text: text, characterMeta: characterMeta };
}

function trimLeadingSpace(text, characterMeta) {
  while (text.charAt(0) === ' ') {
    text = text.slice(1);
    characterMeta = characterMeta.slice(1);
  }
  return { text: text, characterMeta: characterMeta };
}

function trimTrailingSpace(text, characterMeta) {
  while (text.slice(-1) === ' ') {
    text = text.slice(0, -1);
    characterMeta = characterMeta.slice(0, -1);
  }
  return { text: text, characterMeta: characterMeta };
}

function collapseWhiteSpace(text, characterMeta) {
  text = text.replace(/[ \t\n]/g, ' ');

  var _trimLeadingSpace = trimLeadingSpace(text, characterMeta);

  text = _trimLeadingSpace.text;
  characterMeta = _trimLeadingSpace.characterMeta;

  var _trimTrailingSpace = trimTrailingSpace(text, characterMeta);

  text = _trimTrailingSpace.text;
  characterMeta = _trimTrailingSpace.characterMeta;

  var i = text.length;
  while (i--) {
    if (text.charAt(i) === ' ' && text.charAt(i - 1) === ' ') {
      text = text.slice(0, i) + text.slice(i + 1);
      characterMeta = characterMeta.slice(0, i).concat(characterMeta.slice(i + 1));
    }
  }
  // There could still be one space on either side of a softbreak.

  var _replaceTextWithMeta = (0, _replaceTextWithMeta4.default)({ text: text, characterMeta: characterMeta }, SOFT_BREAK_PLACEHOLDER + ' ', SOFT_BREAK_PLACEHOLDER);

  text = _replaceTextWithMeta.text;
  characterMeta = _replaceTextWithMeta.characterMeta;

  var _replaceTextWithMeta2 = (0, _replaceTextWithMeta4.default)({ text: text, characterMeta: characterMeta }, ' ' + SOFT_BREAK_PLACEHOLDER, SOFT_BREAK_PLACEHOLDER);

  text = _replaceTextWithMeta2.text;
  characterMeta = _replaceTextWithMeta2.characterMeta;

  return { text: text, characterMeta: characterMeta };
}

function canHaveDepth(blockType) {
  switch (blockType) {
    case _draftJsUtils.BLOCK_TYPE.UNORDERED_LIST_ITEM:
    case _draftJsUtils.BLOCK_TYPE.ORDERED_LIST_ITEM:
      {
        return true;
      }
    default:
      {
        return false;
      }
  }
}

function concatFragments(fragments) {
  var text = '';
  var characterMeta = (0, _immutable.Seq)();
  fragments.forEach(function (textFragment) {
    text = text + textFragment.text;
    characterMeta = characterMeta.concat(textFragment.characterMeta);
  });
  return { text: text, characterMeta: characterMeta };
}

function addStyleFromTagName(styleSet, tagName, elementStyles) {
  switch (tagName) {
    case 'b':
    case 'strong':
      {
        return styleSet.add(_draftJsUtils.INLINE_STYLE.BOLD);
      }
    case 'i':
    case 'em':
      {
        return styleSet.add(_draftJsUtils.INLINE_STYLE.ITALIC);
      }
    case 'ins':
      {
        return styleSet.add(_draftJsUtils.INLINE_STYLE.UNDERLINE);
      }
    case 'code':
      {
        return styleSet.add(_draftJsUtils.INLINE_STYLE.CODE);
      }
    case 'del':
      {
        return styleSet.add(_draftJsUtils.INLINE_STYLE.STRIKETHROUGH);
      }
    default:
      {
        // Allow custom styles to be provided.
        if (elementStyles && elementStyles[tagName]) {
          return styleSet.add(elementStyles[tagName]);
        }

        return styleSet;
      }
  }
}

function stateFromElement(element, options) {
  var blocks = new BlockGenerator(options).process(element);
  return _draftJs.ContentState.createFromBlockArray(blocks);
}