// LiteLoaderScript Dev Helper
/// <reference path="../HelperLib/src/index.d.ts"/>
/* global ll mc logger NBT file PermType ParamType */

// TypeScript 写上头了，所以塞了一堆类型注解

const PLUGIN_NAME = 'DailyFortune';
/** @type {[number, number, number]} */
const PLUGIN_VERSION = [0, 1, 3];

const PLUGIN_DATA_PATH = `plugins/${PLUGIN_NAME}`;
const PLUGIN_CONFIG_PATH = `${PLUGIN_DATA_PATH}/config.json`;
const PLAYER_CONFIG_PATH = `${PLUGIN_DATA_PATH}/player.json`;
const FORTUNE_CONFIG_PATH = `${PLUGIN_DATA_PATH}/fortune.json`;
const DUMPED_ITEMS_FOLDER = `${PLUGIN_DATA_PATH}/dumped`;

/**
 * @typedef {Object} PluginConfig
 * @property {boolean} broadcast
 * @property {boolean} enableAward
 */
/** @type {PluginConfig} */
let pluginConfig = {
  broadcast: true,
  enableAward: true,
};
/**
 * @typedef {Object} LastFortune
 * @property {number} id
 * @property {number} contentIndex
 */
/**
 * @typedef {Object} PlayerConfig
 * @property {string} lastDate
 * @property {LastFortune} lastFortune
 */
/** @type {{[xuid: string]: PlayerConfig}} */
let playerConfig = {};
/**
 * @typedef {Object} FortuneAward
 * @property {string} [type]
 * @property {number} [amount]
 * @property {number} [aux]
 * @property {string} [sNbt]
 * @property {string} [scoreName]
 * @property {string} [command]
 * @property {string} [filename]
 */
/**
 * @typedef {Object} Fortune
 * @property {number} id
 * @property {string} title
 * @property {string[]} content
 * @property {FortuneAward[]} award
 */
/** @type {Fortune[]} */
let fortuneConfig = [];

/**
 * @param {string} path
 * @param {any} conf
 * @return {boolean}
 */
function writeConfig(path, conf) {
  return file.writeTo(path, JSON.stringify(conf, null, 2));
}

/**
 * @param {string} path
 * @param {any} defaultConf
 * @returns {any}
 */
function initConfig(path, defaultConf = {}) {
  let conf = defaultConf;
  if (file.exists(path)) {
    const content = file.readFrom(path);
    if (content) {
      conf = JSON.parse(content);
      if (defaultConf instanceof Object && !Array.isArray(defaultConf)) {
        Object.entries(defaultConf).forEach(([k, v]) => {
          if (!(k in conf)) conf[k] = v;
        });
      }
    }
  }

  writeConfig(path, conf);
  return conf;
}

function loadConfig() {
  pluginConfig = initConfig(PLUGIN_CONFIG_PATH, pluginConfig);
  playerConfig = initConfig(PLAYER_CONFIG_PATH);
  fortuneConfig = initConfig(FORTUNE_CONFIG_PATH, []);
}

/**
 * 生成指定区间随机整数
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

/**
 * @param {Date} date1
 * @param {Date} [date2]
 * @returns {boolean} date1 = date2
 */
function compareDate(date1, date2) {
  /** @type {(d: Date) => number} */
  const extractDate = (d) => {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  return extractDate(date1) === extractDate(date2 || new Date());
}

/**
 * @param {Fortune} fortune
 * @param {number} contentIndex
 * @param {string} [playerName]
 * @returns {string}
 */
function formatFortune(fortune, contentIndex, playerName) {
  const { title, content } = fortune;
  if (contentIndex >= content.length) contentIndex = content.length - 1;

  const prefix =
    pluginConfig.broadcast && playerName ? `§5玩家 §3${playerName} §5` : `§5你`;
  return `${prefix}的今日运势： ${title}\n§7§o${content[contentIndex]}`;
}

/**
 * @param {number} id
 * @returns {Fortune | undefined}
 */
function getFortuneById(id) {
  for (const x of fortuneConfig) if (x.id === id) return x;
  return undefined;
}

/**
 * @returns {[Fortune, number]}
 */
function rollFortune() {
  const rolledIndex = randomInt(0, fortuneConfig.length - 1);
  const rolled = fortuneConfig[rolledIndex];
  const contentIndex = randomInt(0, rolled.content.length - 1);
  return [rolled, contentIndex];
}

/**
 * @param {Player} player
 * @param {FortuneAward[]} award
 */
function giveAward(player, award) {
  /**
   * @param {FortuneAward} param0
   * @returns {Item | null}
   */
  const getItem = ({
    type,
    amount,
    aux,
    sNbt,
    scoreName,
    command,
    filename,
  }) => {
    if (type === 'dumped') {
      const content = file.readFrom(`${DUMPED_ITEMS_FOLDER}/${filename}`);
      if (!content) {
        logger.error(`Read file ${filename} failed`);
        return null;
      }
      return getItem(JSON.parse(content));
    }

    if (type === 'money') {
      if (!amount) {
        logger.error('Money type award should specify amount');
        return null;
      }
      player.addMoney(amount);
      return null;
    }

    if (type === 'score') {
      if (!scoreName) {
        logger.error('Score type award should specify scoreName');
        return null;
      }

      const scoreObj = mc.getScoreObjective(scoreName);
      if (!scoreObj) {
        // scoreObj = mc.newScoreObjective(scoreName, scoreName);
        mc.runcmdEx(`scoreboard objectives add "${scoreName}" dummy`);
      }

      // scoreObj.addScore(player, amount); // 有bug
      mc.runcmdEx(
        `scoreboard players add "${player.realName}" "${scoreName}" ${amount}`
      );
      return null;
    }

    if (type === 'command') {
      if (!command) {
        logger.error('Command type award should specify command');
        return null;
      }

      command = command.replace(/\{realName\}/g, player.realName);
      mc.runcmdEx(command);
      return null;
    }

    if (sNbt) {
      const res = NBT.parseSNBT(sNbt);
      if (!res) {
        logger.error(`Parse SNBT failed: ${sNbt}`);
        return null;
      }
      return mc.newItem(res);
    }

    if (!type || !amount) {
      logger.error('Item type award should specify type and amount');
      return null;
    }
    const it = mc.newItem(type, amount);
    if (!it) {
      logger.error(`Create item ${type}x${amount} failed`);
      return null;
    }
    if (typeof aux === 'number') it.setAux(aux);
    return it;
  };

  /** @type {Item[]} */
  // @ts-expect-error - type cast
  const items = award.map(getItem).filter((v) => v);

  const container = player.getInventory();
  for (const it of items) {
    if (container.hasRoomFor(it)) container.addItem(it);
    else mc.spawnItem(it, player.pos);
  }
  player.refreshItems();
}

/**
 * @param {Player} player
 */
function todayFortune(player) {
  if (!fortuneConfig.length) {
    player.tell('§c配置文件中还没有配置运势内容');
    return;
  }

  const { xuid } = player;
  const { lastDate, lastFortune } = playerConfig[xuid] || {};

  let fortune;
  let contentIndex;
  let newFortune = true;
  if (lastDate && lastFortune && compareDate(new Date(lastDate))) {
    newFortune = false;
    fortune = getFortuneById(lastFortune.id);
    contentIndex = lastFortune.contentIndex;
  }
  if (!fortune || !contentIndex) {
    if (!newFortune) {
      logger.error(
        `Invalid last fortune id ${lastFortune.id} for player ${player.realName}, reroll`
      );
      newFortune = true;
    }

    [fortune, contentIndex] = rollFortune();

    playerConfig[xuid] = {
      lastDate: new Date().toJSON(),
      lastFortune: { id: fortune.id, contentIndex },
    };
    writeConfig(PLAYER_CONFIG_PATH, playerConfig);

    if (pluginConfig.enableAward) giveAward(player, fortune.award);
  }

  const fortuneText = formatFortune(fortune, contentIndex, player.realName);
  if (pluginConfig.broadcast && newFortune) mc.broadcast(fortuneText);
  else player.tell(fortuneText);
}

/**
 * @param {Player} player
 */
function dumpItem(player) {
  const it = player.getHand();
  if (it.isNull()) {
    player.tell('§c请手持要获取NBT的物品');
    return;
  }

  const sNbt = it.getNbt().toSNBT();
  const itJson = JSON.stringify({ sNbt }, null, 2);

  const filename = `${new Date().getTime()}.json`;
  const path = `${DUMPED_ITEMS_FOLDER}/${filename}`;
  file.writeTo(path, itJson);
  player.tell(`§a已将手持物品的NBT导出至 §6${path}`);
}

/**
 * @param {Player} player
 * @returns {boolean}
 */
function checkOpAndTip(player) {
  const { permLevel } = player;
  const isOp = permLevel > 0;
  if (!isOp) player.tell('§c仅OP能执行这个命令');
  return isOp;
}

mc.listen('onServerStarted', () => {
  const fortuneCmd = mc.newCommand('fortune', '今日运势', PermType.Any);

  fortuneCmd.setEnum('enumDump', ['dump']);
  fortuneCmd.setEnum('enumReload', ['reload']);

  fortuneCmd.mandatory('enumDump', ParamType.Enum, 'enumDump', 1);
  fortuneCmd.mandatory('enumReload', ParamType.Enum, 'enumReload', 1);

  fortuneCmd.overload([]);
  fortuneCmd.overload(['enumDump']);
  fortuneCmd.overload(['enumReload']);

  fortuneCmd.setCallback((_, { player }, out, { enumDump, enumReload }) => {
    if (enumReload) {
      if (!player || checkOpAndTip(player)) {
        loadConfig();
        out.success('§a配置已重载');
        return true;
      }
      return false;
    }

    if (!player) {
      out.error('仅玩家可以执行这个命令');
      return false;
    }

    if (enumDump) {
      if (checkOpAndTip(player)) dumpItem(player);
    } else {
      todayFortune(player);
    }

    return true;
  });
  fortuneCmd.setup();
});

loadConfig();
ll.registerPlugin(PLUGIN_NAME, '今日运势', PLUGIN_VERSION, {
  Author: 'student_2333',
  License: 'Apache-2.0',
});
