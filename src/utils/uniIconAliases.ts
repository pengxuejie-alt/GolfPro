/** lucide-vue-next 组件名 → uni-icons 的 type（@dcloudio/uni-ui） */
export const LUCIDE_TO_UNI: Record<string, string> = {
  ChevronLeft: 'left',
  ChevronRight: 'right',
  Share: 'paperplane',
  MoreHorizontal: 'more',
  UserPlus: 'personadd',
  Minus: 'minus',
  Plus: 'plus',
  X: 'closeempty',
  Edit2: 'compose',
  Trash2: 'trash',
  Trophy: 'medal-filled',
  Award: 'medal',
  Flag: 'flag',
  Check: 'checkmarkempty',
  Users: 'staff',
  MessageCircle: 'chatbubble-filled',
  QrCode: 'scan',
  Eye: 'eye',
  User: 'person',
  Search: 'search',
  Settings: 'gear-filled',
  Calculator: 'bars',
  Bomb: 'fire-filled',
  MapPin: 'map-pin',
  LogOut: 'undo',
  ChevronUp: 'up',
  ChevronDown: 'down',
};

export function lucideNameToUniType(name: string): string {
  return LUCIDE_TO_UNI[name] || 'circle';
}
