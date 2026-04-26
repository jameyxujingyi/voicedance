export type DanceAction =
  | { action: 'play' }
  | { action: 'pause' }
  | { action: 'seek_to_start' }
  | { action: 'fast_forward'; seconds: number }
  | { action: 'fast_backward'; seconds: number }
  | { action: 'set_speed'; speed: number }
  | { action: 'speed_up' }
  | { action: 'speed_down' }
  | { action: 'exit_loop' }
  | { action: 'loop_eight_beat' }
  | { action: 'loop_next_eight_beat' };

export class DanceCommandProcessor {
  private commandIntents: Record<string, DanceAction>;
  private keywordIntentMap: Record<string, string>;

  constructor() {
    this.commandIntents = {
      播放: { action: 'play' },
      暂停: { action: 'pause' },
      回到开头: { action: 'seek_to_start' },
      快进: { action: 'fast_forward', seconds: 10 },
      快进5秒: { action: 'fast_forward', seconds: 5 },
      快退: { action: 'fast_backward', seconds: 10 },
      快退5秒: { action: 'fast_backward', seconds: 5 },
      慢速: { action: 'set_speed', speed: 0.5 },
      正常速度: { action: 'set_speed', speed: 1.0 },
      零点二五倍速: { action: 'set_speed', speed: 0.25 },
      零点七五倍速: { action: 'set_speed', speed: 0.75 },
      一点五倍速: { action: 'set_speed', speed: 1.5 },
      一点二五倍速: { action: 'set_speed', speed: 1.25 },
      一点七五倍速: { action: 'set_speed', speed: 1.75 },
      两倍速: { action: 'set_speed', speed: 2.0 },
      慢一点: { action: 'speed_down' },
      快一点: { action: 'speed_up' },
      退出循环: { action: 'exit_loop' },
      循环这个八拍: { action: 'loop_eight_beat' },
      循环下一个八拍: { action: 'loop_next_eight_beat' },
    };

    this.keywordIntentMap = {
      // 播放相关
      播放: '播放',
      开始: '播放',
      继续: '播放',
      开始播放: '播放',
      继续播放: '播放',
      开工: '播放',
      启动: '播放',
      放吧: '播放',

      // 暂停相关
      暂停: '暂停',
      停下: '暂停',
      停一下: '暂停',
      暂停一下: '暂停',
      停止: '暂停',
      停: '暂停',
      等等: '暂停',
      暂停播放: '暂停',

      // 回到开头
      回到开头: '回到开头',
      重新开始: '回到开头',
      回到起点: '回到开头',
      从头开始: '回到开头',
      回到最初: '回到开头',
      重头来: '回到开头',
      再来一遍: '回到开头',

      // 快进相关（5 秒的写法要先于「快进」以便匹配）
      快进5秒: '快进5秒',
      快进五秒: '快进5秒',
      快进5秒钟: '快进5秒',
      快进: '快进',
      快进十秒: '快进',
      往后: '快进',
      前进: '快进',
      向后: '快进',
      往后一点: '快进',
      往后跳: '快进',
      往后挪: '快进',

      // 快退相关（5 秒的写法要先于「快退」以便匹配）
      快退5秒: '快退5秒',
      快退五秒: '快退5秒',
      快退5秒钟: '快退5秒',
      快退: '快退',
      快退十秒: '快退',
      往前: '快退',
      后退: '快退',
      向前: '快退',
      往前一点: '快退',
      往前跳: '快退',
      往前挪: '快退',
      退回去: '快退',

      // 慢速相关
      慢速: '慢速',
      半速: '慢速',
      零点五倍速: '慢速',
      减速: '慢速',
      慢速播放: '慢速',
      零点二五倍速: '零点二五倍速',
      四分之一倍速: '零点二五倍速',
      零点七五倍速: '零点七五倍速',
      七五倍速: '零点七五倍速',

      // 正常速度相关
      正常速度: '正常速度',
      原速: '正常速度',
      一倍速: '正常速度',
      正常: '正常速度',
      常速: '正常速度',
      恢复正常: '正常速度',

      // 一点五倍速相关
      一点五倍速: '一点五倍速',
      一点五倍: '一点五倍速',
      一点五: '一点五倍速',
      一点二五倍速: '一点二五倍速',
      一点二五倍: '一点二五倍速',
      一点二五: '一点二五倍速',
      一点七五倍速: '一点七五倍速',
      一点七五倍: '一点七五倍速',
      一点七五: '一点七五倍速',

      // 两倍速相关
      两倍速: '两倍速',
      两倍: '两倍速',
      双倍: '两倍速',
      二倍: '两倍速',
      快一点: '快一点',
      加速: '快一点',
      再快一点: '快一点',
      慢一点: '慢一点',
      放慢: '慢一点',
      再慢一点: '慢一点',

      // 循环相关
      循环这个八拍: '循环这个八拍',
      循环播放: '循环这个八拍',
      单曲循环: '循环这个八拍',
      循环: '循环这个八拍',
      重复: '循环这个八拍',
      重复播放: '循环这个八拍',
      锁定这个八拍: '循环这个八拍',
      下一个八拍: '循环下一个八拍',
      下一个: '循环下一个八拍',
      循环下一个八拍: '循环下一个八拍',
      退出循环: '退出循环',
      取消循环: '退出循环',
      结束循环: '退出循环',
      不循环: '退出循环',
    };
  }

  processCommand(userCommand: string): DanceAction | null {
    const cmd = userCommand.trim();
    if (!cmd) return null;

    if (cmd in this.commandIntents) {
      return this.commandIntents[cmd];
    }

    const matchedIntent = this.findBestMatch(cmd);
    if (matchedIntent) {
      return this.commandIntents[matchedIntent] ?? null;
    }
    return null;
  }

  private findBestMatch(command: string): string | null {
    for (const [keyword, intent] of Object.entries(this.keywordIntentMap)) {
      if (command.includes(keyword)) {
        return intent;
      }
    }

    // fallback: simple similarity based on longest common subsequence ratio
    let bestRatio = 0;
    let bestCommand: string | null = null;
    for (const known of Object.keys(this.commandIntents)) {
      const ratio = this.stringSimilarity(command, known);
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestCommand = known;
      }
    }
    if (bestRatio > 0.6) {
      return bestCommand;
    }
    return null;
  }

  // Very lightweight similarity (not full SequenceMatcher but sufficient here)
  private stringSimilarity(a: string, b: string): number {
    if (!a.length || !b.length) return 0;
    const longer = a.length >= b.length ? a : b;
    const shorter = a.length < b.length ? a : b;
    let matches = 0;
    for (const ch of shorter) {
      if (longer.includes(ch)) matches += 1;
    }
    return matches / longer.length;
  }
}

