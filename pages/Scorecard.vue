<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { 
  ChevronLeft, Share, MoreHorizontal, Plus, Minus, 
  Trophy, MapPin, Calculator, X, Settings, Trash2, Edit2,
  UserPlus, Users, QrCode, MessageCircle, LogOut, Flag,
  ChevronRight, Bomb, Target, Award, Info, Check, Search, Eye, User
} from 'lucide-vue-next';
import { Player, Tab } from '../types';
import { useMatchStore, PKRule } from '../store/matchStore';
import { useUserStore } from '../store/userStore';
import { MatchManager } from '../utils/match_manager';
import { gdCourseData } from '../data/guangdongCourses';

const props = defineProps<{
  params?: { match_id: string };
}>();

const emit = defineEmits(['back', 'navigate']);
const matchStore = useMatchStore();
const userStore = useUserStore();
const { profile } = storeToRefs(userStore);
const currentMatch = ref<any>(null);

onMounted(async () => {
  if (props.params?.match_id) {
    const match = await MatchManager.getMatch(props.params.match_id);
    if (match) {
      currentMatch.value = match;
      matchStore.initMatch(match);
    }
  }

  // Load history friends
  const allMatches = await MatchManager.getMatchList();
  const friendsMap = new Map();
  
  allMatches.forEach(m => {
    m.user_list.forEach((u: any) => {
      // Exclude current user and virtual players (temp_...)
      if (u.id !== '1' && !u.id.startsWith('temp_')) {
        friendsMap.set(u.id, u);
      }
    });
  });
  
  historyFriends.value = Array.from(friendsMap.values());
});

// Selection State for Score Input Modal
const showScoreModal = ref(false);
const editingCell = ref<{ pid: string, holeIndex: number } | null>(null);

// Scroll Control
const tableScrollRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const startX = ref(0);
const scrollLeft = ref(0);

const startDragging = (e: MouseEvent | TouchEvent) => {
  if (!tableScrollRef.value) return;
  // Stop propagation to prevent unintended parent click handlers
  e.stopPropagation();
  isDragging.value = true;
  const pageX = 'touches' in e ? e.touches[0].pageX : e.pageX;
  startX.value = pageX - tableScrollRef.value.offsetLeft;
  scrollLeft.value = tableScrollRef.value.scrollLeft;
};

const stopDragging = () => {
  isDragging.value = false;
};

const onDragging = (e: MouseEvent | TouchEvent) => {
  if (!isDragging.value || !tableScrollRef.value) return;
  e.preventDefault();
  const pageX = 'touches' in e ? e.touches[0].pageX : e.pageX;
  const x = pageX - tableScrollRef.value.offsetLeft;
  const walk = (x - startX.value) * 1.5; // Scroll speed
  tableScrollRef.value.scrollLeft = scrollLeft.value - walk;
};

const scrollToSection = (section: 'front' | 'back') => {
  if (!tableScrollRef.value) return;
  const scrollAmount = section === 'front' ? 0 : 450; // Approximate scroll for 9 holes
  tableScrollRef.value.scrollTo({ left: scrollAmount, behavior: 'smooth' });
};

// PK Rules Modal State
const showRulesModal = ref(false);
const showAddRuleOptions = ref(false);
const showConfigModal = ref(false);
const showAddPlayerModal = ref(false);
const showVirtualPlayerPanel = ref(false);
const showSettingsModal = ref(false);
const showEditMatchModal = ref(false);
const showEditCoursePicker = ref(false);
const showEditSectionPicker = ref(false);
const editMatchTitle = ref('');
const editMatchTime = ref('');
const editMatchPrivacy = ref(false);
const editSelectedCourse = ref<any>(null);
const editSelectedSections = ref<any[]>([]);
const editSearchKey = ref('');
const quickAddName = ref('');

const filteredEditCourses = computed(() => {
  const all: any[] = [];
  Object.entries(gdCourseData).forEach(([city, cityCourses]) => {
    cityCourses.forEach(c => {
      all.push({
        ...c,
        city,
        id: c.name
      });
    });
  });
  if (!editSearchKey.value) return all;
  const key = editSearchKey.value.toLowerCase();
  return all.filter(c => c.name.toLowerCase().includes(key) || c.city.toLowerCase().includes(key));
});

const showPKScoreModal = ref(false);
const selectedPKRuleId = ref<string>('all');

const showHistoryFriendsModal = ref(false);
const showQRCodeModal = ref(false);
const showJoinChoiceModal = ref(false);
const joiningUser = ref<any>(null);

const showPlayerActionModal = ref(false);
const selectedPlayer = ref<any>(null);

const isInitiator = computed(() => {
  // Assuming current user ID is '1' and they are the initiator
  return true; 
});

const openPlayerActionModal = (player: any) => {
  if (player.isPending) {
    showAddPlayerModal.value = true;
    return;
  }
  selectedPlayer.value = player;
  showPlayerActionModal.value = true;
};

const handleViewProfile = () => {
  if (selectedPlayer.value) {
    emit('navigate', Tab.PLAYER_PROFILE, { 
      player_id: selectedPlayer.value.id,
      from: Tab.SCORECARD,
      match_id: props.params?.match_id
    });
    showPlayerActionModal.value = false;
  }
};

const confirmDeletePlayer = () => {
  if (selectedPlayer.value) {
    handleRemovePlayer(selectedPlayer.value);
    showPlayerActionModal.value = false;
  }
};

const historyFriends = ref<any[]>([]);

const handleAddPlayerOption = (optId: string) => {
  if (optId === 'virtual') {
    showVirtualPlayerPanel.value = true;
    showAddPlayerModal.value = false;
  } else if (optId === 'history') {
    showHistoryFriendsModal.value = true;
    showAddPlayerModal.value = false;
  } else if (optId === 'wechat') {
    // Mock WeChat Share
    const title = `${profile.value.nickname}邀请你加入球赛`;
    console.log('Sharing to WeChat:', title);
    alert(`已生成微信分享卡片：\n标题：${title}\n内容：点击加入或围观比赛`);
    showAddPlayerModal.value = false;
    
    // Simulate someone clicking the link after 3 seconds
    setTimeout(() => {
      simulateUserJoining({
        id: 'wx_' + Date.now(),
        nickname: '微信好友' + Math.floor(Math.random() * 100),
        avatar: `https://picsum.photos/seed/${Date.now()}/100/100`,
        handicap: 20
      });
    }, 3000);
  } else if (optId === 'qrcode') {
    showQRCodeModal.value = true;
    showAddPlayerModal.value = false;
  }
};

const simulateUserJoining = (user: any) => {
  joiningUser.value = user;
  showJoinChoiceModal.value = true;
};

const handleJoinAsPlayer = () => {
  if (joiningUser.value) {
    matchStore.addPlayer(joiningUser.value);
    if (currentMatch.value) {
      currentMatch.value.user_list = matchStore.user_list;
      saveMatch();
    }
    showJoinChoiceModal.value = false;
    joiningUser.value = null;
    alert('已加入比赛');
  }
};

const handleSpectate = () => {
  showJoinChoiceModal.value = false;
  joiningUser.value = null;
  alert('已进入围观模式');
};

const addHistoryFriend = (friend: any) => {
  matchStore.addPlayer({ ...friend });
  if (currentMatch.value) {
    currentMatch.value.user_list = matchStore.user_list;
    saveMatch();
  }
  showHistoryFriendsModal.value = false;
};

const handleQuickAdd = () => {
  if (!quickAddName.value.trim()) return;
  
  const newPlayer = {
    id: 'temp_' + Date.now(),
    nickname: quickAddName.value.trim(),
    handicap: 18,
    avatar: `https://picsum.photos/seed/${Date.now()}/100/100`
  };
  
  // Add to match store using the new action
  matchStore.addPlayer(newPlayer);
  
  // Also update currentMatch and save
  if (currentMatch.value) {
    currentMatch.value.user_list = matchStore.user_list;
    currentMatch.value.hole_scores = matchStore.holeScores;
    saveMatch();
  }
  
  quickAddName.value = '';
  showAddPlayerModal.value = false;
  showVirtualPlayerPanel.value = false;
};

// Sub-modals for Tiger configuration
const showTigerPlayerSelect = ref(false);
const tigerSelectMode = ref<'tiger' | 'participants' | 'handicap'>('tiger');
const showHandicapInput = ref(false);
const pendingHandicapPlayer = ref<Player | null>(null);
const handicapValue = ref(0);

// Sub-modals for Strokes configuration
const showLandmineModal = ref(false);
const showParticipantModal = ref(false);
const showHandicapModal = ref(false);
const showTotalHandicapModal = ref(false);
const showHandicapValueModal = ref(false);
const showRewardModal = ref(false);
const showWinConditionModal = ref(false);
const showTieModal = ref(false);
const showCollectTieModal = ref(false);
const showStrokesPlayerSelect = ref(false);
const showHoleSelectModal = ref(false);
const showParHandicapModal = ref(false);
const showHoleHandicapModal = ref(false);
const showStartingHoleModal = ref(false);
const strokesSelectIndex = ref(0);

const currentConfigRule = ref<any>(null);

const addPlayerOptions = [
  { id: 'history', name: '历史同组好友', icon: Users, color: 'text-blue-400' },
  { id: 'wechat', name: '微信好友', icon: MessageCircle, color: 'text-green-400' },
  { id: 'virtual', name: '添加虚拟球友', icon: UserPlus, color: 'text-orange-400' },
  { id: 'qrcode', name: '展示比赛二维码', icon: QrCode, color: 'text-purple-400' }
];

const settingsOptions = [
  { id: 'end', name: '结束比赛', icon: Trophy, color: 'text-yellow-500', action: 'finish' },
  { id: 'edit', name: '修改比赛', icon: Edit2, color: 'text-blue-500', action: 'edit' },
  { id: 'leave', name: '我要退赛', icon: LogOut, color: 'text-red-500', action: 'leave' }
];

const handleSettingsAction = (action: string) => {
  if (action === 'finish') {
    if (currentMatch.value) {
      if (confirm('结束比赛后分数将不能修改，是否确定结束？')) {
        currentMatch.value.status = 2;
        saveMatch();
        // Stay on page, but scores are now uneditable (handled in openScoreModal)
      }
    }
  } else if (action === 'edit') {
    if (currentMatch.value) {
      editMatchTitle.value = currentMatch.value.title;
      editMatchTime.value = currentMatch.value.create_time ? new Date(currentMatch.value.create_time).toISOString().slice(0, 16) : '';
      editMatchPrivacy.value = currentMatch.value.is_private || false;
      // Find course in gdCourseData to populate sections if needed
      const allCourses: any[] = [];
      Object.values(gdCourseData).forEach(cityCourses => {
        cityCourses.forEach(c => allCourses.push(c));
      });
      const course = allCourses.find(c => c.name === currentMatch.value.course_name || currentMatch.value.course_name.startsWith(c.name));
      editSelectedCourse.value = course || { name: currentMatch.value.course_name, total_par: 72 };
      showEditMatchModal.value = true;
    }
  }
  showSettingsModal.value = false;
};

const handleEditCourseSelect = (course: any) => {
  if (course.sections) {
    editSelectedCourse.value = course;
    editSelectedSections.value = [];
    showEditSectionPicker.value = true;
    showEditCoursePicker.value = false;
  } else {
    editSelectedCourse.value = course;
    editSelectedSections.value = [];
    showEditCoursePicker.value = false;
  }
};

const toggleEditSection = (section: any) => {
  const idx = editSelectedSections.value.findIndex(s => s.name === section.name);
  if (idx > -1) {
    editSelectedSections.value.splice(idx, 1);
  } else {
    if (editSelectedSections.value.length < 2) {
      editSelectedSections.value.push(section);
    } else {
      editSelectedSections.value[1] = section;
    }
  }
};

const confirmEditSections = () => {
  if (editSelectedSections.value.length === 2) {
    const combinedHoles = [
      ...editSelectedSections.value[0].holes_par.map((par: number, i: number) => ({ no: i + 1, par })),
      ...editSelectedSections.value[1].holes_par.map((par: number, i: number) => ({ no: i + 10, par }))
    ];
    editSelectedCourse.value = {
      ...editSelectedCourse.value,
      name: `${editSelectedCourse.value.name} (${editSelectedSections.value[0].name}+${editSelectedSections.value[1].name})`,
      holes: combinedHoles,
      total_par: editSelectedSections.value[0].holes_par.reduce((a: number, b: number) => a + b, 0) + 
                 editSelectedSections.value[1].holes_par.reduce((a: number, b: number) => a + b, 0)
    };
    showEditSectionPicker.value = false;
  }
};

const saveMatchEdits = async () => {
  if (currentMatch.value) {
    currentMatch.value.title = editMatchTitle.value;
    currentMatch.value.create_time = editMatchTime.value ? new Date(editMatchTime.value).getTime() : Date.now();
    currentMatch.value.is_private = editMatchPrivacy.value;
    if (editSelectedCourse.value.holes) {
      currentMatch.value.course_name = editSelectedCourse.value.name;
      // Update hole pars but keep existing scores
      currentMatch.value.hole_scores = editSelectedCourse.value.holes.map((h: any, i: number) => {
        const existing = currentMatch.value.hole_scores[i] || { scores: new Array(matchStore.user_list.length).fill(0) };
        return {
          scores: existing.scores,
          par: h.par
        };
      });
      // Sync store
      matchStore.initMatch(currentMatch.value);
    }
    await saveMatch();
    showEditMatchModal.value = false;
  }
};

const singleHangRules = [
  { type: 'strokes', name: '挂杆', sub: '单挂/多人互挂' },
  { type: 'holes', name: '挂洞', sub: '单挂/多人互挂' },
  { type: '8421_1v1', name: '挂8421', sub: '单挂/多人互挂' }
];

const multiPlayerRules = [
  { type: 'landlord', name: '斗地主', sub: '3分/8421等' },
  { type: 'vegas_4', name: '4人拉斯', sub: '4人拉斯游戏' },
  { type: 'tiger', name: '打老虎', sub: '最好成绩PK老虎' }
];

const selectRuleForConfig = (rule: any) => {
  if (rule.type === 'tiger') {
    emit('navigate', Tab.PK_TIGER, { match_id: props.params?.match_id });
    showAddRuleOptions.value = false;
    return;
  }
  if (rule.type === 'landlord') {
    emit('navigate', Tab.PK_DIZHU, { match_id: props.params?.match_id });
    showAddRuleOptions.value = false;
    return;
  }
  if (rule.type === 'vegas_4') {
    emit('navigate', Tab.PK_LASHI, { match_id: props.params?.match_id });
    showAddRuleOptions.value = false;
    return;
  }

  if (rule.type === 'strokes') {
    currentConfigRule.value = {
      ...rule,
      base_score: 1,
      landmines: {
        front: 0,
        back: 0,
        multiplier: 2,
        assignedHoles: []
      },
      participant_count: 2,
      player_ids: [],
      handicap_config: {
        type: 'none',
        value: 0
      },
      reward_config: '1',
      valid_holes: Array.from({ length: 18 }, (_, i) => i + 1),
      win_condition: 'lower_strokes',
      tie_type: 'add_one',
      collect_tie_type: 'standard',
      handicap_type: 'strokes', // 'strokes' or 'holes'
      handicap_par_strokes: { par3: 0, par4: 0, par5: 0 },
      handicap_holes_count: 0,
      starting_hole: 1,
      handicap_receiver_index: 1 // 0 for player 1, 1 for player 2
    };
  } else if (rule.type === 'holes') {
    currentConfigRule.value = {
      ...rule,
      base_score: 1,
      landmines: {
        front: 0,
        back: 0,
        multiplier: 2,
        assignedHoles: []
      },
      participant_count: 2,
      player_ids: [],
      handicap_config: {
        type: 'none',
        value: 0
      },
      reward_config: '1',
      valid_holes: Array.from({ length: 18 }, (_, i) => i + 1),
      win_condition: 'lower_strokes',
      tie_type: 'add_one',
      collect_tie_type: 'standard',
      handicap_type: 'strokes', // 'strokes' or 'holes'
      handicap_par_strokes: { par3: 0, par4: 0, par5: 0 },
      handicap_holes_count: 0,
      starting_hole: 1,
      handicap_receiver_index: 1 // 0 for player 1, 1 for player 2
    };
  } else if (rule.type === '8421_1v1') {
    currentConfigRule.value = {
      ...rule,
      base_score: 1,
      landmines: {
        front: 0,
        back: 0,
        multiplier: 2,
        assignedHoles: []
      },
      participant_count: 2,
      player_ids: [],
      handicap_config: {
        type: 'none',
        value: 0
      },
      handicap_receiver_index: 1,
      reward_config: '1',
      valid_holes: Array.from({ length: 18 }, (_, i) => i + 1),
      deduction_type: 'progressive',
      deduction_par3_plus3: false,
      tie_type: 'add_one',
      collect_tie_type: 'par_1_birdie_2_eagle_all'
    };
  } else {
    currentConfigRule.value = {
      ...rule,
      base_score: 1,
      birdie_double: true,
      is_mon: false
    };
  }
  showAddRuleOptions.value = false;
  showConfigModal.value = true;
};

const randomizeLandmines = () => {
  if (!currentConfigRule.value?.landmines) return;
  const { front, back } = currentConfigRule.value.landmines;
  const frontHoles = Array.from({ length: 9 }, (_, i) => i + 1);
  const backHoles = Array.from({ length: 9 }, (_, i) => i + 10);
  
  const shuffle = (array: number[]) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  
  const selectedFront = shuffle(frontHoles).slice(0, front);
  const selectedBack = shuffle(backHoles).slice(0, back);
  
  currentConfigRule.value.landmines.assignedHoles = [...selectedFront, ...selectedBack].sort((a, b) => a - b);
};

const handleStrokesPlayerSelect = (player: Player) => {
  if (!currentConfigRule.value.player_ids) currentConfigRule.value.player_ids = [];
  
  // Check if player already selected in another slot
  const existingIdx = currentConfigRule.value.player_ids.indexOf(player.id);
  if (existingIdx !== -1 && existingIdx !== strokesSelectIndex.value) {
    // Swap or alert? Let's just swap
    currentConfigRule.value.player_ids[existingIdx] = currentConfigRule.value.player_ids[strokesSelectIndex.value];
  }
  
  currentConfigRule.value.player_ids[strokesSelectIndex.value] = player.id;
  showStrokesPlayerSelect.value = false;
};

const getRewardText = (config: string) => {
  const options: Record<string, string> = {
    '1': '鸟1/鹰5/HIO(双鹰)10',
    '2': '鸟1/鹰10/HIO(双鹰)20',
    '3': '鸟*2/鹰*4/HIO(双鹰)*8',
    '4': '鸟*2/鹰*5/HIO(双鹰)*10'
  };
  return options[config] || '';
};

const getHandicapText = (config: any) => {
  if (!config || config.type === 'none') return `总分让 ${config?.value || 0}杆`;
  if (config.type === 'virtual') return '虚让';
  return `${config.type}让1`;
};

// Tiger Logic Functions
const toggleHole = (holeNum: number) => {
  const index = currentConfigRule.value.valid_holes.indexOf(holeNum);
  if (index > -1) {
    currentConfigRule.value.valid_holes.splice(index, 1);
  } else {
    currentConfigRule.value.valid_holes.push(holeNum);
    currentConfigRule.value.valid_holes.sort((a: number, b: number) => a - b);
  }
};

const setHoleRange = (range: 'all' | 'front' | 'back') => {
  if (range === 'all') {
    currentConfigRule.value.valid_holes = Array.from({ length: 18 }, (_, i) => i + 1);
  } else if (range === 'front') {
    currentConfigRule.value.valid_holes = Array.from({ length: 9 }, (_, i) => i + 1);
  } else if (range === 'back') {
    currentConfigRule.value.valid_holes = Array.from({ length: 9 }, (_, i) => i + 10);
  }
};

const openPlayerSelect = (mode: 'tiger' | 'participants' | 'handicap') => {
  tigerSelectMode.value = mode;
  showTigerPlayerSelect.value = true;
};

const handleTigerPlayerSelect = (player: Player) => {
  if (tigerSelectMode.value === 'tiger') {
    currentConfigRule.value.tiger_user_id = player.id;
    // Remove from participants if it was there
    currentConfigRule.value.player_ids = currentConfigRule.value.player_ids.filter((id: string) => id !== player.id);
    showTigerPlayerSelect.value = false;
  } else if (tigerSelectMode.value === 'participants') {
    const index = currentConfigRule.value.player_ids.indexOf(player.id);
    if (index > -1) {
      currentConfigRule.value.player_ids.splice(index, 1);
    } else {
      // Cannot be tiger and participant
      if (player.id !== currentConfigRule.value.tiger_user_id) {
        currentConfigRule.value.player_ids.push(player.id);
      }
    }
  } else if (tigerSelectMode.value === 'handicap') {
    pendingHandicapPlayer.value = player;
    handicapValue.value = 0;
    showTigerPlayerSelect.value = false;
    showHandicapInput.value = true;
  }
};

const confirmHandicap = () => {
  if (pendingHandicapPlayer.value) {
    const existing = currentConfigRule.value.handicap_list.find((h: any) => h.playerId === pendingHandicapPlayer.value?.id);
    if (existing) {
      existing.strokes = handicapValue.value;
    } else {
      currentConfigRule.value.handicap_list.push({
        playerId: pendingHandicapPlayer.value.id,
        playerName: pendingHandicapPlayer.value.nickname,
        strokes: handicapValue.value
      });
    }
  }
  showHandicapInput.value = false;
  pendingHandicapPlayer.value = null;
};

const removeHandicap = (playerId: string) => {
  currentConfigRule.value.handicap_list = currentConfigRule.value.handicap_list.filter((h: any) => h.playerId !== playerId);
};

const confirmAddRule = () => {
  if (!currentConfigRule.value) return;
  
  const ruleData: any = {
    type: currentConfigRule.value.type,
    category: currentConfigRule.value.type.includes('vegas') || currentConfigRule.value.type === 'landlord' || currentConfigRule.value.type === 'tiger' ? 'multi' : 'single',
    name: currentConfigRule.value.name,
    base_score: currentConfigRule.value.base_score,
  };

  if (currentConfigRule.value.type === 'tiger') {
    Object.assign(ruleData, {
      bomb_value: currentConfigRule.value.bomb_value,
      valid_holes: currentConfigRule.value.valid_holes,
      tiger_user_id: currentConfigRule.value.tiger_user_id,
      player_ids: currentConfigRule.value.player_ids,
      handicap_list: currentConfigRule.value.handicap_list,
      compare_type: currentConfigRule.value.compare_type,
      reward_type: currentConfigRule.value.reward_type,
      tie_type: currentConfigRule.value.tie_type,
      collect_tie: currentConfigRule.value.collect_tie
    });
  } else if (currentConfigRule.value.type === 'strokes' || currentConfigRule.value.type === 'holes' || currentConfigRule.value.type === '8421_1v1') {
    Object.assign(ruleData, {
      id: currentConfigRule.value.id, // Keep ID if editing
      valid_holes: currentConfigRule.value.valid_holes,
      landmines: currentConfigRule.value.landmines,
      participant_count: currentConfigRule.value.participant_count,
      player_ids: (currentConfigRule.value.player_ids || []).slice(0, currentConfigRule.value.participant_count),
      handicap_config: currentConfigRule.value.handicap_config,
      reward_config: currentConfigRule.value.reward_config,
      win_condition: currentConfigRule.value.win_condition,
      tie_type: currentConfigRule.value.tie_type,
      collect_tie_type: currentConfigRule.value.collect_tie_type,
      handicap_type: currentConfigRule.value.handicap_type,
      handicap_par_strokes: currentConfigRule.value.handicap_par_strokes,
      handicap_holes_count: currentConfigRule.value.handicap_holes_count,
      starting_hole: currentConfigRule.value.starting_hole,
      handicap_receiver_index: currentConfigRule.value.handicap_receiver_index,
      deduction_type: currentConfigRule.value.deduction_type,
      deduction_par3_plus3: currentConfigRule.value.deduction_par3_plus3
    });
  } else {
    Object.assign(ruleData, {
      is_mon: currentConfigRule.value.is_mon,
      birdie_double: currentConfigRule.value.birdie_double
    });
  }

  matchStore.addRule(ruleData);
  saveMatch();
  showConfigModal.value = false;
};

const removeRule = (id: string) => {
  matchStore.removeRule(id);
  saveMatch();
};

const editRule = (rule: any) => {
  if (rule.type === 'tiger') {
    emit('navigate', Tab.PK_TIGER, { match_id: props.params?.match_id, rule_id: rule.id });
    return;
  }
  if (rule.type === 'vegas_4') {
    emit('navigate', Tab.PK_LASHI, { match_id: props.params?.match_id, rule_id: rule.id });
    return;
  }
  if (rule.type === 'landlord') {
    emit('navigate', Tab.PK_DIZHU, { match_id: props.params?.match_id, rule_id: rule.id });
    return;
  }
  currentConfigRule.value = JSON.parse(JSON.stringify(rule));
  showConfigModal.value = true;
};

const saveMatch = async () => {
  if (currentMatch.value) {
    currentMatch.value.pk_rules = matchStore.activeRules;
    currentMatch.value.hole_scores = matchStore.holeScores;
    currentMatch.value.user_list = matchStore.user_list;
    await MatchManager.updateMatch(currentMatch.value);
  }
};

// Mock Players if not set in store
const players = computed(() => {
  if (matchStore.user_list.length > 0) return matchStore.user_list;
  return [
    { id: '1', nickname: '犬神Rocky', handicap: 12 },
    { id: '2', nickname: 'TEST', handicap: 18 },
    { id: '3', nickname: 'USER', handicap: 24 },
    { id: '4', nickname: 'aaa', handicap: 8 },
  ];
});

onMounted(() => {
  if (matchStore.user_list.length === 0) {
    matchStore.user_list = players.value.map(p => ({
      id: p.id,
      nickname: p.nickname,
      handicap: p.handicap
    }));
  }
});

const holes = computed(() => Array.from({ length: 18 }, (_, i) => ({
  number: i + 1,
  par: matchStore.holeScores[i]?.par || 4,
  index: i
})));

// Score Helpers
const getScore = (pid: string, holeIndex: number) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1 || !matchStore.holeScores[holeIndex]) return 0;
  return matchStore.holeScores[holeIndex].scores[pIdx];
};

const getHoleProfit = (pid: string, holeIndex: number) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return 0;
  // Use the new holeProfits getter which handles carryover correctly
  return matchStore.holeProfits[holeIndex][pIdx] || 0;
};

const getRuleDisplayName = (rule: any) => {
  let typeStr = '';
  if (rule.type === 'holes') typeStr = '比洞';
  else if (rule.type === 'strokes') typeStr = '比杆';
  else if (rule.type === '8421_1v1') typeStr = '挂8421';
  else if (rule.type === 'landlord') typeStr = '斗地主';
  else if (rule.type.includes('vegas')) typeStr = '拉斯';
  else typeStr = rule.name;

  const pNames = (rule.player_ids || []).map((id: string) => {
    const p = players.value.find(p => p.id === id);
    return p ? p.nickname : '未知';
  }).join(';');

  let handicapStr = '平打';
  if (rule.handicap_type === 'strokes' || (rule.handicap_config && rule.handicap_config.type !== 'none')) {
    handicapStr = '让杆';
  } else if (rule.handicap_type === 'holes') {
    handicapStr = '让洞';
  }

  if (rule.type === 'holes' || rule.type === 'strokes' || rule.type === '8421_1v1') {
    return `${typeStr}:${rule.name}/${pNames}/${handicapStr}`;
  }
  return `${typeStr}:${rule.name}`;
};

const getScoreRelativeText = (pid: string, holeIndex: number) => {
  const score = getScore(pid, holeIndex);
  if (!score) return 'E';
  const par = matchStore.holeScores[holeIndex]?.par || 4;
  const diff = score - par;
  return diff === 0 ? 'E' : (diff > 0 ? `+${diff}` : `${diff}`);
};

const getPKTotal = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return 0;
  return matchStore.totalProfits[pIdx];
};

const currentPKProfits = computed(() => {
  if (selectedPKRuleId.value === 'all') {
    return matchStore.holeProfits;
  } else {
    return matchStore.getProfitsByRule(selectedPKRuleId.value);
  }
});

const getPKScoreTotal = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return 0;
  
  let total = 0;
  for (let i = 0; i < 18; i++) {
    total += currentPKProfits.value[i][pIdx] || 0;
  }
  return total;
};

const getPKScoreHole = (pid: string, holeIndex: number) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  if (pIdx === -1) return 0;
  return currentPKProfits.value[holeIndex][pIdx] || 0;
};

const getRoleBadge = (pid: string, holeIndex: number) => {
  const landlordRules = matchStore.activeRules.filter(r => r.type === 'landlord' || r.type === 'tiger');
  if (landlordRules.length === 0) return null;
  
  for (const rule of landlordRules) {
    const config = rule.config;
    // For flowing landlord, only show if determined by previous hole's scores
    if (config?.landlord_type === '流动地主' || config?.category === '流动老虎') {
      if (holeIndex > 0) {
        const prevHole = matchStore.holeScores[holeIndex - 1];
        if (!prevHole || prevHole.scores.every(s => s === 0)) continue;
      }
    }

    const lIdx = matchStore.getLandlordIndex(holeIndex, rule);
    if (lIdx === -1) continue;
    const landlordId = matchStore.user_list[lIdx]?.id;
    if (landlordId === pid) {
      return rule.type === 'tiger' ? '虎' : '地';
    }
  }
  return null;
};

const getVegasTeamColor = (pid: string, holeIndex: number) => {
  const vegasRule = matchStore.activeRules.find(r => r.type === 'vegas_4');
  if (!vegasRule) return null;

  const { teamA, teamB } = matchStore.getVegasGrouping(holeIndex, vegasRule);
  const pIdx = players.value.findIndex(p => p.id === pid);
  
  if (teamA.includes(pIdx)) return 'bg-red-500';
  if (teamB.includes(pIdx)) return 'bg-blue-500';
  return null;
};

const getTotalPar = () => {
  return matchStore.holeScores.reduce((sum, h) => sum + (h.par || 4), 0);
};

const getFront9 = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  const playedHoles = matchStore.holeScores.slice(0, 9).filter(h => h.scores[pIdx] > 0);
  if (playedHoles.length === 0) return '0';
  
  const strokes = playedHoles.reduce((sum, h) => sum + h.scores[pIdx], 0);
  const par = playedHoles.reduce((sum, h) => sum + (h.par || 4), 0);
  const diff = strokes - par;
  return diff === 0 ? '0' : (diff > 0 ? `+${diff}` : `${diff}`);
};

const getBack9 = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  const playedHoles = matchStore.holeScores.slice(9, 18).filter(h => h.scores[pIdx] > 0);
  if (playedHoles.length === 0) return '0';

  const strokes = playedHoles.reduce((sum, h) => sum + h.scores[pIdx], 0);
  const par = playedHoles.reduce((sum, h) => sum + (h.par || 4), 0);
  const diff = strokes - par;
  return diff === 0 ? '0' : (diff > 0 ? `+${diff}` : `${diff}`);
};

const getTotalDiff = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  const playedHoles = matchStore.holeScores.filter(h => h.scores[pIdx] > 0);
  if (playedHoles.length === 0) return '0';

  const strokes = playedHoles.reduce((sum, h) => sum + h.scores[pIdx], 0);
  const par = playedHoles.reduce((sum, h) => sum + (h.par || 4), 0);
  const diff = strokes - par;
  return diff === 0 ? '0' : (diff > 0 ? `+${diff}` : `${diff}`);
};

const getTotalStrokes = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  return matchStore.holeScores.reduce((sum, h) => sum + (h.scores[pIdx] || 0), 0);
};

const get8421Points = (pid: string) => {
  const pIdx = players.value.findIndex(p => p.id === pid);
  return Math.round(matchStore.total8421Points[pIdx]);
};

const saveScore = async () => {
  if (!editingCell.value) return;
  const pIdx = players.value.findIndex(p => p.id === editingCell.value!.pid);
  const hIdx = editingCell.value!.holeIndex;
  const currentVal = matchStore.holeScores[hIdx].scores[pIdx];
  if (currentVal === 0) {
    // If no score was set, default to Par
    matchStore.updateScore(hIdx, pIdx, matchStore.holeScores[hIdx].par);
  }
  await saveMatch();
  showScoreModal.value = false;
};

// Modal Actions
const openScoreModal = (pid: string, holeIndex: number) => {
  if (currentMatch.value?.status === 2) return; // Prevent editing finished match
  editingCell.value = { pid, holeIndex };
  showScoreModal.value = true;
};

const updateScore = (delta: number) => {
  if (!editingCell.value) return;
  const pIdx = players.value.findIndex(p => p.id === editingCell.value!.pid);
  const hIdx = editingCell.value!.holeIndex;
  const currentVal = matchStore.holeScores[hIdx].scores[pIdx] || matchStore.holeScores[hIdx].par;
  matchStore.updateScore(hIdx, pIdx, Math.max(1, currentVal + delta));
  saveMatch();
};

const clearScore = () => {
  if (!editingCell.value) return;
  const pIdx = players.value.findIndex(p => p.id === editingCell.value!.pid);
  matchStore.updateScore(editingCell.value!.holeIndex, pIdx, 0);
  saveMatch();
  showScoreModal.value = false;
};

const handleRemovePlayer = (player: Player) => {
  if (player.id === '1') {
    // Don't allow removing the host
    return;
  }
  
  if (confirm(`确定要删除球手 ${player.nickname} 及其所有成绩吗？`)) {
    matchStore.removePlayer(player.id);
    if (currentMatch.value) {
      currentMatch.value.user_list = matchStore.user_list;
      currentMatch.value.hole_scores = matchStore.holeScores;
      saveMatch();
    }
  }
};

const addRule = () => {
  matchStore.addRule({
    type: newRuleType.value,
    base_score: newRuleBase.value,
    is_mon: false,
    birdie_double: true
  });
};

const showShareModal = ref(false);

const handleShare = (type: 'friend' | 'moments') => {
  showShareModal.value = true;
};

const getScoreDiffText = (pid: string, holeIndex: number) => {
  const score = getScore(pid, holeIndex);
  if (!score || !matchStore.holeScores[holeIndex]) return '';
  const par = matchStore.holeScores[holeIndex].par;
  const diff = score - par;
  return diff === 0 ? '0' : (diff > 0 ? `+${diff}` : `${diff}`);
};

const getScoreShapeClasses = (pid: string, holeIndex: number) => {
  const score = getScore(pid, holeIndex);
  if (!score || !matchStore.holeScores[holeIndex]) return 'border-transparent text-slate-700';
  const par = matchStore.holeScores[holeIndex].par;
  const diff = score - par;
  
  if (diff <= -2) return 'rounded-full border-double border-4 border-red-600 text-white bg-red-800'; // Eagle or better
  if (diff === -1) return 'rounded-full border-red-500 text-white bg-red-600'; // Birdie
  if (diff === 0) return 'rounded-full border-slate-300 text-slate-100 bg-slate-800'; // Par
  if (diff === 1) return 'rounded-none border border-slate-400 text-white bg-black'; // Bogey - Single box
  if (diff >= 2) return 'rounded-none border-double border-4 border-slate-400 text-slate-400 bg-slate-950'; // Double Bogey or worse - Double box
  return 'border-transparent text-slate-300';
};

const isLandmineExploded = (holeIndex: number) => {
  const holeNum = holeIndex + 1;
  const strokesRule = matchStore.activeRules.find(r => r.type === 'strokes' && r.landmines?.assignedHoles.includes(holeNum));
  if (!strokesRule) return false;
  
  const hole = matchStore.holeScores[holeIndex];
  return hole && !hole.scores.some(s => s === 0);
};
</script>

<template>
  <div class="fixed inset-0 bg-slate-950 text-slate-100 flex flex-col font-sans select-none safe-top">
    <!-- Header -->
    <header class="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50 pr-[90px]">
      <button @click="emit('back')" class="p-2 -ml-2 hover:bg-slate-800 rounded-full transition-colors">
        <ChevronLeft class="w-6 h-6" />
      </button>
      <div class="flex flex-col items-center flex-1">
        <h1 class="text-base font-bold tracking-tight truncate max-w-[150px]">{{ currentMatch?.course_name || '高尔夫比赛' }}</h1>
        <div class="flex items-center gap-2 text-[10px] text-slate-400">
          <span>{{ currentMatch?.create_time ? new Date(currentMatch.create_time).toLocaleDateString() : '2026-03-21' }}</span>
          <span>{{ currentMatch?.create_time ? new Date(currentMatch.create_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '' }}</span>
        </div>
      </div>
      <button @click="handleShare('friend')" class="p-2 hover:bg-slate-800 rounded-full transition-colors absolute left-12">
        <Share class="w-5 h-5" />
      </button>
    </header>

    <!-- Quick Navigation Toggle -->
    <div class="flex items-center justify-center gap-2 p-2 bg-slate-900/30 border-b border-slate-800">
      <button @click="scrollToSection('front')" class="px-3 py-1 rounded-full bg-slate-800 text-[11px] font-bold text-slate-300 hover:bg-slate-700 active:scale-95 transition-all">
        前九 (1-9)
      </button>
      <button @click="scrollToSection('back')" class="px-3 py-1 rounded-full bg-slate-800 text-[11px] font-bold text-slate-300 hover:bg-slate-700 active:scale-95 transition-all">
        后九 (10-18)
      </button>
    </div>

    <!-- Main Scorecard Table -->
    <div class="flex-1 overflow-hidden flex flex-col">
      <div ref="tableScrollRef" 
           class="flex-1 overflow-x-auto overflow-y-auto relative no-scrollbar select-none cursor-grab active:cursor-grabbing"
           @mousedown="startDragging"
           @mousemove="onDragging"
           @mouseup="stopDragging"
           @mouseleave="stopDragging"
           @touchstart="startDragging"
           @touchmove="onDragging"
           @touchend="stopDragging">
        <table class="w-full border-collapse table-fixed min-w-max">
          <thead class="sticky top-0 z-40 bg-slate-900 shadow-sm">
            <tr>
              <!-- Fixed Left Header - Robust Portrait Width -->
              <th class="sticky left-0 z-50 bg-slate-900 border-b border-r border-slate-800 w-28 p-0">
                <div class="h-14 flex flex-col items-center justify-center">
                  <span class="text-xs font-bold text-slate-400">洞号</span>
                  <span class="text-[11px] text-slate-500">标准杆</span>
                </div>
              </th>
              
              <!-- Hole Numbers -->
              <template v-for="(h, idx) in holes" :key="h.number">
                <th class="border-b border-r border-slate-800 w-14 p-0">
                  <div class="h-14 flex flex-col items-center justify-center">
                    <div class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold mb-0.5">
                      {{ h.number }}
                    </div>
                    <span class="text-xs text-slate-500 font-mono">{{ h.par }}</span>
                  </div>
                </th>
                <!-- Insert Front 9 Summary after hole 9 -->
                <th v-if="idx === 8" class="border-b border-r border-slate-800 w-14 p-0 bg-slate-900/80">
                  <div class="h-14 flex items-center justify-center text-xs font-bold text-slate-400">前9</div>
                </th>
              </template>

              <!-- Summary Headers -->
              <th class="border-b border-r border-slate-800 w-12 p-0 bg-slate-900/80">
                <div class="h-14 flex items-center justify-center text-xs font-bold text-slate-500">标准杆</div>
              </th>
              <th class="border-b border-r border-slate-800 w-14 p-0 bg-slate-900/80">
                <div class="h-14 flex items-center justify-center text-xs font-bold text-slate-400">后9</div>
              </th>
              <th class="border-b border-r border-slate-800 w-14 p-0 bg-slate-900/80">
                <div class="h-14 flex items-center justify-center text-xs font-bold text-slate-400">总差</div>
              </th>
              <th class="border-b border-r border-slate-800 w-14 p-0 bg-slate-900/80">
                <div class="h-14 flex items-center justify-center text-xs font-bold text-slate-400">总杆</div>
              </th>
              <th class="border-b border-r border-slate-800 w-16 p-0 bg-slate-900/80">
                <div class="h-14 flex items-center justify-center text-xs font-bold text-red-400">PK</div>
              </th>
              <th class="border-b border-slate-800 w-16 p-0 bg-slate-900/80">
                <div class="h-14 flex items-center justify-center text-xs font-bold text-slate-400">8421</div>
              </th>
            </tr>
          </thead>

          <tbody>
            <tr v-for="player in players" :key="player.id" class="group">
              <!-- Fixed Left Player Info -->
              <td class="sticky left-0 z-30 bg-slate-900 border-b border-r border-slate-800 p-2">
                  <div @click="openPlayerActionModal(player)" class="flex items-center gap-2 cursor-pointer active:opacity-70">
                    <div v-if="player.isPending" 
                         class="w-8 h-8 rounded bg-slate-800 border border-dashed border-slate-600 flex items-center justify-center">
                      <UserPlus class="w-4 h-4 text-slate-500" />
                    </div>
                    <img v-else 
                         :src="player.avatar || `https://picsum.photos/seed/${player.id}/100/100`" 
                         class="w-8 h-8 rounded bg-slate-800 border border-slate-700 object-cover" 
                         referrerPolicy="no-referrer" />
                    <div class="flex flex-col min-w-0">
                      <span class="text-xs font-bold truncate leading-tight" :class="player.isPending ? 'text-slate-500 italic' : ''">{{ player.nickname }}</span>
                      <span class="text-[11px] text-slate-500">{{ player.handicap }}</span>
                    </div>
                  </div>
              </td>

              <!-- Hole Scores -->
              <template v-for="(h, idx) in holes" :key="h.number">
                <td @click="openScoreModal(player.id, h.index)"
                    class="border-b border-r border-slate-800 p-1 cursor-pointer active:bg-slate-800 transition-colors relative">
                  <div class="h-12 flex flex-col items-center justify-center gap-0.5">
                    <div class="w-8 h-8 flex items-center justify-center border transition-all relative"
                         :class="getScoreShapeClasses(player.id, h.index)">
                      <span class="text-sm font-bold">{{ getScoreDiffText(player.id, h.index) || '-' }}</span>
                      <!-- Role Indicator -->
                      <div v-if="getRoleBadge(player.id, h.index)" 
                           class="absolute -top-1 -left-1 w-3.5 h-3.5 bg-red-600 rounded-sm flex items-center justify-center border border-white/20 shadow-sm z-10">
                        <span class="text-[9px] font-black text-white leading-none">{{ getRoleBadge(player.id, h.index) }}</span>
                      </div>
                      <!-- Vegas Team Indicator -->
                      <div v-if="getVegasTeamColor(player.id, h.index)"
                           class="absolute top-0 right-0 w-0 h-0 border-t-[6px] border-l-[6px] border-l-transparent z-10"
                           :class="getVegasTeamColor(player.id, h.index).replace('bg-', 'border-t-')">
                      </div>
                    </div>
                    <span v-if="getScore(player.id, h.index)" 
                          class="text-[11px] font-mono leading-none"
                          :class="getHoleProfit(player.id, h.index) >= 0 ? 'text-red-400' : 'text-green-400'">
                      {{ getHoleProfit(player.id, h.index) > 0 ? '+' : '' }}{{ getHoleProfit(player.id, h.index) }}
                    </span>
                  </div>
                  <Bomb v-if="isLandmineExploded(h.index)" class="w-2.5 h-2.5 text-red-500 absolute top-1.5 right-1.5 animate-pulse" />
                </td>
                <!-- Insert Front 9 Value after hole 9 -->
                <td v-if="idx === 8" class="border-b border-r border-slate-800 bg-slate-900/50 text-center font-mono text-xs font-bold text-slate-300">
                  {{ getFront9(player.id) }}
                </td>
              </template>

              <!-- Summary Values -->
              <td class="border-b border-r border-slate-800 bg-slate-900/50 text-center font-mono text-xs text-slate-500">
                {{ getTotalPar() }}
              </td>
              <td class="border-b border-r border-slate-800 bg-slate-900/50 text-center font-mono text-xs font-bold text-slate-300">
                {{ getBack9(player.id) }}
              </td>
              <td class="border-b border-r border-slate-800 bg-slate-900/50 text-center font-mono text-xs font-bold text-slate-300">
                {{ getTotalDiff(player.id) }}
              </td>
              <td class="border-b border-r border-slate-800 bg-slate-900/50 text-center font-mono text-sm font-bold text-white">
                {{ getTotalStrokes(player.id) }}
              </td>
              <td class="border-b border-r border-slate-800 bg-slate-900/50 text-center font-mono text-sm font-bold"
                  :class="getPKTotal(player.id) >= 0 ? 'text-red-400' : 'text-green-400'">
                {{ getPKTotal(player.id) > 0 ? '+' : '' }}{{ getPKTotal(player.id) }}
              </td>
              <td class="border-b border-slate-800 bg-slate-900/50 text-center font-mono text-xs font-bold text-yellow-500">
                {{ (get8421Points(player.id) || 0).toFixed(1) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Bottom Actions -->
    <div class="p-4 bg-slate-900 border-t border-slate-800 flex items-center justify-around gap-4 pb-8">
      <button @click="showAddPlayerModal = true" class="flex flex-col items-center gap-1 group">
        <div class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center group-active:scale-95 transition-transform">
          <UserPlus class="w-5 h-5 text-blue-500" />
        </div>
        <span class="text-[12px] font-bold text-slate-400">+球手</span>
      </button>

      <button @click="showRulesModal = true" class="flex flex-col items-center gap-1 group">
        <div class="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center group-active:scale-95 transition-transform shadow-lg shadow-red-900/20">
          <span class="text-xs font-black italic">PK</span>
        </div>
        <span class="text-[12px] font-bold text-slate-400">PK规则</span>
      </button>

      <button v-if="matchStore.activeRules.length > 0" @click="showPKScoreModal = true" class="flex flex-col items-center gap-1 group">
        <div class="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center group-active:scale-95 transition-transform shadow-lg shadow-blue-900/20">
          <Calculator class="w-5 h-5 text-white" />
        </div>
        <span class="text-[12px] font-bold text-slate-400">PK得分</span>
      </button>

      <button @click="showSettingsModal = true" class="flex flex-col items-center gap-1 group">
        <div class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center group-active:scale-95 transition-transform">
          <Settings class="w-5 h-5 text-slate-400" />
        </div>
        <span class="text-[12px] font-bold text-slate-400">设置</span>
      </button>
    </div>

    <!-- Score Input Modal (Bottom Sheet) -->
    <div v-if="showScoreModal" class="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 backdrop-blur-sm transition-opacity" @click.self="showScoreModal = false">
      <div class="w-full max-w-lg bg-white rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div class="flex items-center gap-3">
            <img :src="`https://picsum.photos/seed/${editingCell?.pid}/100/100`" class="w-10 h-10 rounded-full border-2 border-white shadow-sm" />
            <div>
              <div class="text-sm font-bold text-slate-900">{{ players.find(p => p.id === editingCell?.pid)?.nickname || '未知球手' }}</div>
              <div class="text-[10px] text-slate-500">Hole {{ (editingCell?.holeIndex || 0) + 1 }} / Par {{ matchStore.holeScores[editingCell?.holeIndex || 0]?.par || 4 }}</div>
            </div>
          </div>
          <button @click="showScoreModal = false" class="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div class="p-8 flex flex-col items-center gap-8">
          <div class="flex items-center gap-8">
            <button @click="updateScore(-1)" class="w-14 h-14 rounded-full border-2 border-slate-200 flex items-center justify-center hover:bg-slate-50 active:scale-90 transition-all">
              <Minus class="w-6 h-6 text-slate-600" />
            </button>
            <div class="text-5xl font-black text-slate-900 w-24 text-center">
              {{ editingCell ? getScoreRelativeText(editingCell.pid, editingCell.holeIndex) : 'E' }}
            </div>
            <button @click="updateScore(1)" class="w-14 h-14 rounded-full border-2 border-slate-200 flex items-center justify-center hover:bg-slate-50 active:scale-90 transition-all">
              <Plus class="w-6 h-6 text-slate-600" />
            </button>
          </div>

          <div class="w-full flex gap-4">
            <button @click="clearScore" class="flex-1 py-4 rounded-xl border-2 border-slate-200 text-slate-600 font-bold hover:bg-slate-50 active:scale-95 transition-all">
              清除
            </button>
            <button @click="saveScore" class="flex-2 py-4 rounded-xl bg-green-500 text-white font-bold shadow-lg shadow-green-200 hover:bg-green-600 active:scale-95 transition-all">
              确认
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- PK Rules Modal -->
    <div v-if="showRulesModal" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" @click.self="showRulesModal = false">
      <div class="w-full max-w-md bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 sticky top-0 z-10">
          <h2 class="text-base font-bold">PK 规则设置</h2>
          <button @click="showRulesModal = false" class="p-1 hover:bg-slate-800 rounded-full">
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-4">
          <!-- Active Rules List -->
          <div v-if="matchStore.activeRules.length > 0" class="space-y-3">
            <h3 class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">当前生效规则</h3>
            <div v-for="rule in matchStore.activeRules" :key="rule.id" class="p-3 bg-slate-800 rounded-xl flex items-center justify-between border border-slate-700">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold text-[10px]">
                  {{ rule.name }}
                </div>
                <div class="flex flex-col">
                  <span class="text-sm font-medium">{{ rule.name }}</span>
                  <span class="text-[10px] text-slate-500">基数: {{ rule.base_score }}</span>
                </div>
              </div>
              <div class="flex items-center gap-1">
                <button @click="editRule(rule); showRulesModal = false" class="p-2 text-blue-400 hover:bg-blue-400/10 rounded-lg transition-colors">
                  <Edit2 class="w-4 h-4" />
                </button>
                <button @click="removeRule(rule.id)" class="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <!-- Empty State -->
          <div v-else class="py-12 flex flex-col items-center justify-center text-slate-500 gap-3">
            <Trophy class="w-12 h-12 opacity-20" />
            <span class="text-sm">暂无生效规则</span>
          </div>
        </div>

        <div class="p-4 bg-slate-900 border-t border-slate-800">
          <button @click="showAddRuleOptions = true; showRulesModal = false" class="w-full py-3 bg-slate-100 text-slate-900 rounded-xl font-bold hover:bg-white active:scale-95 transition-all flex items-center justify-center gap-2">
            <Plus class="w-5 h-5" />
            新建 PK 规则
          </button>
        </div>
      </div>
    </div>

    <!-- Add Rule Options Modal (Grid Layout) -->
    <div v-if="showAddRuleOptions" class="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/95 backdrop-blur-md" @click.self="showAddRuleOptions = false">
      <div class="w-full max-w-md flex flex-col gap-6">
        <div class="flex items-center justify-between">
          <button @click="showAddRuleOptions = false" class="p-2 hover:bg-slate-800 rounded-full">
            <ChevronLeft class="w-6 h-6" />
          </button>
          <h2 class="text-base font-bold">选择 PK 玩法</h2>
          <div class="w-10"></div>
        </div>

        <!-- Single Hang Section -->
        <div class="space-y-4">
          <div class="flex items-center justify-center">
            <div class="px-6 py-1.5 rounded-full bg-slate-800/80 text-[11px] font-bold text-slate-400 border border-slate-700 shadow-lg">
              单挂 (1对1)
            </div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <button v-for="rule in singleHangRules" :key="rule.type" 
                    @click="selectRuleForConfig(rule)"
                    class="bg-[#1a1a1a] border border-slate-800 rounded-2xl p-4 flex flex-col items-center gap-2 hover:border-slate-600 active:scale-95 transition-all group">
              <span class="text-base font-bold">{{ rule.name }}</span>
              <span class="text-[9px] text-slate-500 text-center leading-tight h-6 flex items-center">{{ rule.sub }}</span>
            </button>
          </div>
          <div class="flex justify-center">
            <button class="px-8 py-2.5 rounded-full bg-[#262626] text-[11px] font-bold text-slate-300 border border-slate-700 active:scale-95 transition-all">批量单挂工具</button>
          </div>
        </div>

        <!-- Multi-player Section -->
        <div class="space-y-4">
          <div class="flex items-center justify-center">
            <div class="px-6 py-1.5 rounded-full bg-slate-800/80 text-[11px] font-bold text-slate-400 border border-slate-700 shadow-lg">
              3人以上游戏
            </div>
          </div>
          <div class="grid grid-cols-3 gap-4">
            <button v-for="rule in multiPlayerRules" :key="rule.type" 
                    @click="selectRuleForConfig(rule)"
                    class="bg-[#1a1a1a] border border-slate-800 rounded-2xl p-4 flex flex-col items-center gap-2 hover:border-slate-600 active:scale-95 transition-all">
              <span class="text-base font-bold">{{ rule.name }}</span>
              <span class="text-[9px] text-slate-500 text-center leading-tight h-6 flex items-center">{{ rule.sub }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
    <!-- Rule Configuration Modal -->
    <div v-if="showConfigModal" class="fixed inset-0 z-[120] flex flex-col bg-black text-white overflow-hidden animate-in slide-in-from-bottom duration-300">
      <!-- Header -->
      <header class="flex items-center justify-between px-4 py-3 border-b border-slate-900 bg-black sticky top-0 z-50">
        <button @click="showConfigModal = false" class="p-2 -ml-2 hover:bg-slate-900 rounded-full transition-colors">
          <ChevronLeft class="w-6 h-6" />
        </button>
        <h1 class="text-lg font-bold">{{ currentConfigRule?.name }}</h1>
        <div class="flex items-center gap-2">
          <button class="p-2 hover:bg-slate-900 rounded-full transition-colors">
            <MoreHorizontal class="w-6 h-6" />
          </button>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto bg-black">
        <!-- Tiger Specific UI -->
        <template v-if="currentConfigRule?.type === 'strokes'">

            <!-- Handicap List -->
            <div v-if="currentConfigRule?.handicap_list?.length > 0" class="px-4 space-y-2">
              <div v-for="h in currentConfigRule.handicap_list" :key="h.playerId" class="flex items-center justify-between bg-slate-900/40 p-3 rounded-xl border border-slate-800">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold">
                    {{ players.find(p => p.id === h.playerId)?.nickname?.charAt(0) || '?' }}
                  </div>
                  <span class="text-sm">{{ h.playerName }}</span>
                </div>
                <div class="flex items-center gap-4">
                  <span class="text-sm text-orange-500">受让 {{ h.strokes }} 杆</span>
                  <button @click="removeHandicap(h.playerId)" class="p-1 text-slate-500">
                    <X class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
        </template>

        <!-- Match Play Configuration (比洞) -->
        <template v-else-if="currentConfigRule?.type === 'holes'">
          <div class="p-4 space-y-6">
            <!-- Header Icons -->
            <div class="flex justify-end gap-4 mb-4">
              <button @click="showLandmineModal = true" 
                      class="flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all"
                      :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'bg-red-600 border-red-400' : 'bg-red-950/30 border border-red-900/50'">
                <Bomb class="w-8 h-8 mb-1" :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'text-white' : 'text-red-500'" />
                <span class="text-[10px]" :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'text-white' : 'text-red-400'">埋地雷</span>
              </button>
              <div class="flex flex-col items-center justify-center w-20 h-20 rounded-2xl bg-red-900 text-white relative">
                <span class="text-2xl font-black">{{ currentConfigRule?.base_score || 1 }}</span>
                <span class="text-[10px] opacity-70">基本单位</span>
                <div class="absolute -bottom-2 flex gap-1">
                  <button @click.stop="currentConfigRule && (currentConfigRule.base_score = Math.max(1, currentConfigRule.base_score - 1))" class="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                    <Minus class="w-3 h-3" />
                  </button>
                  <button @click.stop="currentConfigRule && (currentConfigRule.base_score++)" class="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                    <Plus class="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Settings List -->
            <div class="space-y-0.5">
              <!-- Starting Hole -->
              <div @click="showStartingHoleModal = true" class="flex items-center justify-between p-4 bg-slate-900/20 hover:bg-slate-900/40 transition-colors cursor-pointer border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm">出发洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-300">{{ currentConfigRule?.starting_hole }}号洞</span>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>

              <!-- Valid Holes -->
              <div @click="showHoleSelectModal = true" class="flex items-center justify-between p-4 bg-slate-900/20 hover:bg-slate-900/40 transition-colors cursor-pointer border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm">有效洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex gap-0.5 max-w-[100px] flex-wrap justify-end">
                    <div v-for="i in 18" :key="i" class="w-1.5 h-1.5 rounded-full" :class="currentConfigRule?.valid_holes?.includes(i) ? 'bg-orange-500' : 'bg-slate-800'"></div>
                  </div>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>

              <!-- Fixed Participants for Match Play -->
              <div class="flex items-center justify-between p-4 bg-slate-900/20 border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm">参与人数</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-300">2-人单挂</span>
                </div>
              </div>
            </div>

            <!-- Player Selection Circles -->
            <div class="flex items-center justify-center gap-4 py-6">
              <div v-for="i in 2" :key="i" 
                   @click="strokesSelectIndex = i-1; showStrokesPlayerSelect = true"
                   class="w-32 h-32 rounded-full border-2 flex flex-col items-center justify-center transition-all cursor-pointer overflow-hidden flex-shrink-0 relative"
                   :class="currentConfigRule?.player_ids?.[i-1] ? (currentConfigRule.handicap_receiver_index === i-1 ? 'border-orange-500 bg-orange-500/10' : 'border-slate-700 bg-slate-900/20') : 'border-dashed border-slate-800 bg-slate-900/10'">
                <!-- Handicap Receiver Badge -->
                <div v-if="currentConfigRule.handicap_receiver_index === i-1" 
                     class="absolute top-2 right-2 bg-orange-500 text-white text-[8px] px-1.5 py-0.5 rounded-full font-bold">
                  受让方
                </div>
                
                <template v-if="currentConfigRule?.player_ids?.[i-1]">
                  <div class="w-16 h-16 rounded-full mb-1 border-2 border-white bg-slate-800 flex items-center justify-center text-xl font-bold">
                    {{ players.find(p => p.id === currentConfigRule.player_ids[i-1])?.nickname?.charAt(0) || '?' }}
                  </div>
                  <span class="text-xs font-bold">{{ players.find(p => p.id === currentConfigRule.player_ids[i-1])?.nickname || '未知' }}</span>
                  <span class="text-[10px] opacity-60">选手{{ i }}</span>
                </template>
                <template v-else>
                  <UserPlus class="w-8 h-8 text-slate-700 mb-1" />
                  <span class="text-sm font-bold text-slate-500">选手{{ i }}</span>
                </template>
              </div>
            </div>

            <!-- Handicap Selection (让杆/让洞) -->
            <div class="flex flex-col gap-4 px-4">
              <div class="flex gap-4">
                <button @click="currentConfigRule.handicap_type = 'strokes'; showParHandicapModal = true"
                        class="flex-1 py-3 rounded-xl border flex flex-col items-center gap-1 transition-all"
                        :class="currentConfigRule.handicap_type === 'strokes' ? 'bg-orange-600/20 border-orange-500' : 'bg-slate-900/40 border-slate-800 text-slate-500'">
                  <span class="text-sm font-bold">让杆</span>
                  <span class="text-[10px] opacity-60">
                    {{ currentConfigRule.handicap_par_strokes.par3 }}/{{ currentConfigRule.handicap_par_strokes.par4 }}/{{ currentConfigRule.handicap_par_strokes.par5 }}
                  </span>
                </button>
                <button @click="currentConfigRule.handicap_type = 'holes'; showHoleHandicapModal = true"
                        class="flex-1 py-3 rounded-xl border flex flex-col items-center gap-1 transition-all"
                        :class="currentConfigRule.handicap_type === 'holes' ? 'bg-orange-600/20 border-orange-500' : 'bg-slate-900/40 border-slate-800 text-slate-500'">
                  <span class="text-sm font-bold">让洞</span>
                  <span class="text-[10px] opacity-60">让 {{ currentConfigRule.handicap_holes_count }} 洞</span>
                </button>
              </div>
              
              <!-- Receiver Toggle -->
              <div class="flex items-center justify-between p-3 bg-slate-900/40 rounded-xl border border-slate-800">
                <span class="text-xs text-slate-400">受让方</span>
                <div class="flex bg-slate-800 rounded-lg p-1">
                  <button v-for="i in 2" :key="i"
                          @click="currentConfigRule.handicap_receiver_index = i-1"
                          class="px-4 py-1 rounded-md text-[10px] font-bold transition-all"
                          :class="currentConfigRule.handicap_receiver_index === i-1 ? 'bg-orange-600 text-white shadow-sm' : 'text-slate-500'">
                    选手{{ i }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Bottom Settings -->
            <div class="space-y-0.5">
              <div @click="showRewardModal = true" class="flex items-center justify-between p-4 bg-slate-900/20 hover:bg-slate-900/40 transition-colors cursor-pointer border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <Award class="w-5 h-5 text-slate-500" />
                  <span class="text-sm">奖励</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-300 truncate max-w-[150px]">{{ getRewardText(currentConfigRule?.reward_config || '1') }}</span>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>

              <div @click="showWinConditionModal = true" class="flex items-center justify-between p-4 bg-slate-900/20 hover:bg-slate-900/40 transition-colors cursor-pointer border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm">赢洞条件</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-300">{{ currentConfigRule?.win_condition === 'lower_strokes' ? '杆数少者算赢' : '其他' }}</span>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>

              <div @click="showTieModal = true" class="flex items-center justify-between p-4 bg-slate-900/20 hover:bg-slate-900/40 transition-colors cursor-pointer border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm">顶洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-300">{{ currentConfigRule?.tie_type === 'add_one' ? '下洞加1分' : '不加分' }}</span>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>

              <div @click="showCollectTieModal = true" class="flex items-center justify-between p-4 bg-slate-900/20 hover:bg-slate-900/40 transition-colors cursor-pointer border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm">收顶洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-300">帕收1/鸟收2/鹰全收</span>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>
            </div>

            <!-- Action Button -->
            <div class="pt-6">
              <button @click="confirmAddRule" class="w-full py-4 bg-red-600 text-white rounded-full font-bold shadow-lg shadow-red-900/20 active:scale-95 transition-all">
                确认并返回
              </button>
            </div>
          </div>
        </template>

        <!-- Strokes Configuration (比杆) -->
        <template v-else-if="currentConfigRule?.type === 'strokes'">
          <div class="p-4 space-y-6">
            <!-- Header Icons -->
            <div class="flex justify-end gap-4 mb-4">
              <button @click="showLandmineModal = true" 
                      class="flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all"
                      :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'bg-red-600 border-red-400' : 'bg-red-950/30 border border-red-900/50'">
                <Bomb class="w-8 h-8 mb-1" :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'text-white' : 'text-red-500'" />
                <span class="text-[10px]" :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'text-white' : 'text-red-400'">埋地雷</span>
              </button>
              <div class="flex flex-col items-center justify-center w-20 h-20 rounded-2xl bg-red-900 text-white relative">
                <span class="text-2xl font-black">{{ currentConfigRule?.base_score || 1 }}</span>
                <span class="text-[10px] opacity-70">基本单位</span>
                <div class="absolute -bottom-2 flex gap-1">
                  <button @click.stop="currentConfigRule && (currentConfigRule.base_score = Math.max(1, currentConfigRule.base_score - 1))" class="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                    <Minus class="w-3 h-3" />
                  </button>
                  <button @click.stop="currentConfigRule && (currentConfigRule.base_score++)" class="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                    <Plus class="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Settings List -->
            <div class="space-y-0.5">
              <!-- Valid Holes -->
              <div @click="showHoleSelectModal = true" class="flex items-center justify-between p-4 bg-slate-900/20 hover:bg-slate-900/40 transition-colors cursor-pointer border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm">有效洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex gap-0.5 max-w-[100px] flex-wrap justify-end">
                    <div v-for="i in 18" :key="i" class="w-1.5 h-1.5 rounded-full" :class="currentConfigRule?.valid_holes?.includes(i) ? 'bg-orange-500' : 'bg-slate-800'"></div>
                  </div>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>

              <!-- Participants -->
              <div @click="showParticipantModal = true" class="flex items-center justify-between p-4 bg-slate-900/20 hover:bg-slate-900/40 transition-colors cursor-pointer border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm">参与人数</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-300">{{ currentConfigRule?.participant_count || 2 }}-人单挂</span>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>
            </div>

            <!-- Player Selection Circles -->
            <div class="flex items-center justify-center gap-4 py-6 overflow-x-auto no-scrollbar">
              <div v-for="i in (currentConfigRule?.participant_count || 0)" :key="i" 
                   @click="strokesSelectIndex = i-1; showStrokesPlayerSelect = true"
                   class="w-32 h-32 rounded-full border-2 flex flex-col items-center justify-center transition-all cursor-pointer overflow-hidden flex-shrink-0"
                   :class="currentConfigRule?.player_ids?.[i-1] ? 'border-orange-500 bg-orange-500/10' : 'border-dashed border-slate-800 bg-slate-900/10'">
                <template v-if="currentConfigRule?.player_ids?.[i-1]">
                  <div class="w-16 h-16 rounded-full mb-1 border-2 border-white bg-slate-800 flex items-center justify-center text-xl font-bold">
                    {{ players.find(p => p.id === currentConfigRule.player_ids[i-1])?.nickname?.charAt(0) || '?' }}
                  </div>
                  <span class="text-xs font-bold">{{ players.find(p => p.id === currentConfigRule.player_ids[i-1])?.nickname || '未知' }}</span>
                  <span class="text-[10px] opacity-60">选手{{ i }}</span>
                </template>
                <template v-else>
                  <UserPlus class="w-8 h-8 text-slate-700 mb-1" />
                  <span class="text-sm font-bold text-slate-500">选手{{ i }}</span>
                </template>
              </div>
            </div>

            <!-- Bottom Settings -->
            <div class="space-y-0.5">
              <div @click="showHandicapModal = true" class="flex items-center justify-between p-4 bg-slate-900/20 hover:bg-slate-900/40 transition-colors cursor-pointer border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <Flag class="w-5 h-5 text-slate-500" />
                  <span class="text-sm">单让</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-300">{{ getHandicapText(currentConfigRule?.handicap_config) }}</span>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>

              <div @click="showRewardModal = true" class="flex items-center justify-between p-4 bg-slate-900/20 hover:bg-slate-900/40 transition-colors cursor-pointer border-b border-slate-900/50">
                <div class="flex items-center gap-3">
                  <Award class="w-5 h-5 text-slate-500" />
                  <span class="text-sm">奖励</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-300 truncate max-w-[150px]">{{ getRewardText(currentConfigRule?.reward_config || '1') }}</span>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>
            </div>

            <!-- Action Button -->
            <div class="pt-6">
              <button @click="confirmAddRule" class="w-full py-4 bg-red-600 text-white rounded-full font-bold shadow-lg shadow-red-900/20 active:scale-95 transition-all">
                确认并返回
              </button>
            </div>
          </div>
        </template>

        <!-- 8421 Configuration (挂8421) -->
        <template v-else-if="currentConfigRule?.type === '8421_1v1'">
          <div class="p-4 space-y-6 bg-slate-950 min-h-[70vh]">
            <!-- Header Icons -->
            <div class="flex justify-end gap-4 mb-4">
              <button @click="showLandmineModal = true" 
                      class="flex flex-col items-center justify-center w-20 h-20 rounded-2xl transition-all"
                      :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'bg-red-600 border-red-400' : 'bg-red-950/30 border border-red-900/50'">
                <Bomb class="w-8 h-8 mb-1" :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'text-white' : 'text-red-500'" />
                <span class="text-[10px]" :class="currentConfigRule?.landmines?.assignedHoles?.length > 0 ? 'text-white' : 'text-red-400'">埋地雷</span>
              </button>
              <div class="flex flex-col items-center justify-center w-20 h-20 rounded-2xl bg-red-900 text-white relative">
                <span class="text-2xl font-black">{{ currentConfigRule?.base_score || 1 }}</span>
                <span class="text-[10px] opacity-70">基本单位</span>
                <div class="absolute -bottom-2 flex gap-1">
                  <button @click.stop="currentConfigRule && (currentConfigRule.base_score = Math.max(1, currentConfigRule.base_score - 1))" class="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                    <Minus class="w-3 h-3" />
                  </button>
                  <button @click.stop="currentConfigRule && (currentConfigRule.base_score++)" class="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                    <Plus class="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            <!-- Settings List -->
            <div class="space-y-0.5 rounded-3xl overflow-hidden border border-slate-900">
              <!-- Valid Holes -->
              <div @click="showHoleSelectModal = true" class="flex items-center justify-between p-4 bg-slate-900/40 hover:bg-slate-900/60 transition-colors cursor-pointer border-b border-slate-900">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm font-medium">有效洞</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex gap-0.5 max-w-[120px] flex-wrap justify-end">
                    <div v-for="i in 18" :key="i" class="w-1.5 h-1.5 rounded-full" :class="currentConfigRule?.valid_holes?.includes(i) ? 'bg-orange-500' : 'bg-slate-800'"></div>
                  </div>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>

              <!-- Participants -->
              <div @click="showParticipantModal = true" class="flex items-center justify-between p-4 bg-slate-900/40 hover:bg-slate-900/60 transition-colors cursor-pointer border-b border-slate-900">
                <div class="flex items-center gap-3">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm font-medium">参与人数</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-slate-300">{{ currentConfigRule?.participant_count || 2 }}-人单挂</span>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>
            </div>

            <!-- Player Selection Circles -->
            <div class="flex items-center justify-center gap-6 py-4 overflow-x-auto no-scrollbar px-4">
              <div v-for="i in (currentConfigRule?.participant_count || 2)" :key="i" 
                   @click="strokesSelectIndex = i-1; showStrokesPlayerSelect = true"
                   class="w-36 h-36 rounded-full border-2 flex flex-col items-center justify-center transition-all cursor-pointer overflow-hidden flex-shrink-0"
                   :class="currentConfigRule?.player_ids?.[i-1] ? 'border-orange-500 bg-orange-500/10' : 'border-dashed border-slate-800 bg-slate-900/10'">
                <template v-if="currentConfigRule?.player_ids?.[i-1]">
                  <div class="w-16 h-16 rounded-full mb-1 border-2 border-white bg-slate-800 flex items-center justify-center text-xl font-bold text-white shadow-lg">
                    {{ players.find(p => p.id === currentConfigRule.player_ids[i-1])?.nickname?.charAt(0) || '?' }}
                  </div>
                  <span class="text-xs font-bold text-slate-200">{{ players.find(p => p.id === currentConfigRule.player_ids[i-1])?.nickname || '未知' }}</span>
                  <span class="text-[10px] text-slate-400 mt-0.5">选手{{ i }}</span>
                </template>
                <template v-else>
                  <span class="text-lg font-bold text-slate-600">选手{{ i }}</span>
                </template>
              </div>
            </div>

            <!-- Bottom Settings -->
            <div class="space-y-4">
              <!-- Handicap -->
              <div @click="showTotalHandicapModal = true" class="flex items-center justify-between p-4 bg-slate-900/40 hover:bg-slate-900/60 transition-colors cursor-pointer rounded-2xl border border-slate-900">
                <div class="flex items-center gap-3">
                  <Flag class="w-5 h-5 text-slate-500" />
                  <span class="text-sm font-medium">单让</span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm font-bold text-slate-200">总分让 {{ currentConfigRule?.handicap_config?.value || 0 }}分</span>
                  <ChevronRight class="w-4 h-4 text-slate-600" />
                </div>
              </div>

              <!-- Deductions Panel (Matching Image) -->
              <div class="p-5 bg-slate-900/40 rounded-3xl border border-slate-900 space-y-4">
                <div class="flex items-center gap-3 mb-1">
                  <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                    <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                  </div>
                  <span class="text-sm font-medium">扣分</span>
                </div>
                
                <div class="space-y-3 pl-1">
                  <div class="flex flex-col gap-3">
                    <label class="flex items-center gap-3 cursor-pointer group">
                      <div class="w-5 h-5 rounded border border-slate-700 flex items-center justify-center transition-colors"
                           :class="currentConfigRule.deduction_type === 'progressive' ? 'bg-orange-600 border-orange-500' : 'bg-slate-800'">
                        <Check v-if="currentConfigRule.deduction_type === 'progressive'" class="w-3.5 h-3.5 text-white" />
                      </div>
                      <input type="radio" v-model="currentConfigRule.deduction_type" value="progressive" class="hidden">
                      <span class="text-sm text-slate-300 group-hover:text-white transition-colors">扣分 (+4扣1分 +5扣2分...以此类推)</span>
                    </label>
                    
                    <div class="pl-8" v-if="currentConfigRule.deduction_type === 'progressive'">
                      <label class="flex items-center gap-3 cursor-pointer group">
                        <div class="w-4 h-4 rounded border border-slate-700 flex items-center justify-center transition-colors"
                             :class="currentConfigRule.deduction_par3_plus3 ? 'bg-orange-600 border-orange-500' : 'bg-slate-800'">
                          <Check v-if="currentConfigRule.deduction_par3_plus3" class="w-3 h-3 text-white" />
                        </div>
                        <input type="checkbox" v-model="currentConfigRule.deduction_par3_plus3" class="hidden">
                        <span class="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">3杆洞从+3开始扣分</span>
                      </label>
                    </div>

                    <label class="flex items-center gap-3 cursor-pointer group">
                      <div class="w-5 h-5 rounded border border-slate-700 flex items-center justify-center transition-colors"
                           :class="currentConfigRule.deduction_type === 'single_plus4' ? 'bg-orange-600 border-orange-500' : 'bg-slate-800'">
                        <Check v-if="currentConfigRule.deduction_type === 'single_plus4'" class="w-3.5 h-3.5 text-white" />
                      </div>
                      <input type="radio" v-model="currentConfigRule.deduction_type" value="single_plus4" class="hidden">
                      <span class="text-sm text-slate-300 group-hover:text-white transition-colors">只扣1分 (+4及以上)</span>
                    </label>

                    <label class="flex items-center gap-3 cursor-pointer group">
                      <div class="w-5 h-5 rounded border border-slate-700 flex items-center justify-center transition-colors"
                           :class="currentConfigRule.deduction_type === 'single_double_par' ? 'bg-orange-600 border-orange-500' : 'bg-slate-800'">
                        <Check v-if="currentConfigRule.deduction_type === 'single_double_par'" class="w-3.5 h-3.5 text-white" />
                      </div>
                      <input type="radio" v-model="currentConfigRule.deduction_type" value="single_double_par" class="hidden">
                      <span class="text-sm text-slate-300 group-hover:text-white transition-colors">只扣1分 (双帕及以上)</span>
                    </label>
                  </div>
                </div>
              </div>

              <!-- Carryover Settings -->
              <div class="rounded-3xl overflow-hidden border border-slate-900">
                <div @click="showTieModal = true" class="flex items-center justify-between p-4 bg-slate-900/40 hover:bg-slate-900/60 transition-colors cursor-pointer border-b border-slate-900">
                  <div class="flex items-center gap-3">
                    <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                      <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                    </div>
                    <span class="text-sm font-medium">顶洞</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-bold text-slate-200">{{ currentConfigRule?.tie_type === 'add_one' ? '下洞加1分' : '不加分' }}</span>
                    <ChevronRight class="w-4 h-4 text-slate-600" />
                  </div>
                </div>

                <div @click="showCollectTieModal = true" class="flex items-center justify-between p-4 bg-slate-900/40 hover:bg-slate-900/60 transition-colors cursor-pointer">
                  <div class="flex items-center gap-3">
                    <div class="w-5 h-5 rounded-full border border-slate-700 flex items-center justify-center">
                      <div class="w-2 h-2 rounded-full bg-slate-700"></div>
                    </div>
                    <span class="text-sm font-medium">收顶洞</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-bold text-slate-200">
                      {{ currentConfigRule?.collect_tie_type === 'par_1_birdie_2_eagle_all' ? '帕收1/鸟收2/鹰全收' : '全收' }}
                    </span>
                    <ChevronRight class="w-4 h-4 text-slate-600" />
                  </div>
                </div>
              </div>
            </div>

            <!-- Action Button -->
            <div class="pt-4 pb-8">
              <button @click="confirmAddRule" class="w-full py-5 bg-red-700 text-white rounded-2xl font-black text-lg shadow-xl shadow-red-950/40 active:scale-95 transition-all">
                确认并返回
              </button>
            </div>
          </div>
        </template>

        <!-- Generic Configuration (for other rules) -->
        <template v-else>
          <div class="p-6 space-y-6 pb-12">
            <!-- Base Score -->
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-slate-300">基数 (分/杆)</span>
              <div class="flex items-center gap-4">
                <button @click="currentConfigRule && (currentConfigRule.base_score = Math.max(1, currentConfigRule.base_score - 1))" class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                  <Minus class="w-4 h-4" />
                </button>
                <span class="text-lg font-bold w-8 text-center">{{ currentConfigRule?.base_score || 1 }}</span>
                <button @click="currentConfigRule && (currentConfigRule.base_score++)" class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center">
                  <Plus class="w-4 h-4" />
                </button>
              </div>
            </div>

            <!-- Birdie Double -->
            <div class="flex items-center justify-between">
              <div class="flex flex-col">
                <span class="text-sm font-medium text-slate-300">鸟鹰翻倍</span>
                <span class="text-[10px] text-slate-500">抓鸟/抓鹰得分翻倍</span>
              </div>
              <button @click="currentConfigRule && (currentConfigRule.birdie_double = !currentConfigRule.birdie_double)" 
                      class="w-12 h-6 rounded-full transition-colors relative"
                      :class="currentConfigRule?.birdie_double ? 'bg-red-600' : 'bg-slate-700'">
                <div class="absolute top-1 w-4 h-4 bg-white rounded-full transition-all"
                     :class="currentConfigRule?.birdie_double ? 'left-7' : 'left-1'"></div>
              </button>
            </div>

            <!-- Vegas Specific -->
            <template v-if="currentConfigRule?.type === 'vegas_4'">
              <div class="flex items-center justify-between">
                <div class="flex flex-col">
                  <span class="text-sm font-medium text-slate-300">高手不见面</span>
                  <span class="text-[10px] text-slate-500">防止最强两名选手同组</span>
                </div>
                <button @click="currentConfigRule && (currentConfigRule.is_mon = !currentConfigRule.is_mon)" 
                        class="w-12 h-6 rounded-full transition-colors relative"
                        :class="currentConfigRule?.is_mon ? 'bg-red-600' : 'bg-slate-700'">
                  <div class="absolute top-1 w-4 h-4 bg-white rounded-full transition-all"
                       :class="currentConfigRule?.is_mon ? 'left-7' : 'left-1'"></div>
                </button>
              </div>
            </template>

            <button @click="confirmAddRule" class="w-full py-4 bg-red-600 text-white rounded-xl font-bold shadow-lg shadow-red-900/20 active:scale-95 transition-all mt-4">
              确认添加
            </button>
          </div>
        </template>
      </div>
    </div>

    <!-- Tiger Player Selection Modal -->
    <div v-if="showTigerPlayerSelect" class="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showTigerPlayerSelect = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">
            {{ tigerSelectMode === 'tiger' ? '选择老虎' : tigerSelectMode === 'participants' ? '选择参与者' : '选择受让球手' }}
          </h2>
          <button @click="showTigerPlayerSelect = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-4 max-h-[60vh] overflow-y-auto">
          <div class="grid grid-cols-4 gap-4">
            <button v-for="player in players" :key="player.id" 
                    @click="handleTigerPlayerSelect(player)"
                    class="flex flex-col items-center gap-2 p-2 rounded-xl transition-all"
                    :class="[
                      tigerSelectMode === 'tiger' && currentConfigRule.tiger_user_id === player.id ? 'bg-orange-500/20 ring-1 ring-orange-500' : 
                      tigerSelectMode === 'participants' && currentConfigRule.player_ids.includes(player.id) ? 'bg-blue-500/20 ring-1 ring-blue-500' : 
                      'hover:bg-slate-800'
                    ]">
              <div class="w-12 h-12 rounded-full border-2 border-slate-700 bg-slate-800 flex items-center justify-center text-lg font-bold">
                {{ player.nickname.charAt(0) }}
              </div>
              <span class="text-[10px] font-medium truncate w-full text-center">{{ player.nickname }}</span>
            </button>
          </div>
        </div>
        <div class="p-4 bg-slate-950/50">
          <button @click="showTigerPlayerSelect = false" class="w-full py-3 bg-slate-800 text-white rounded-xl font-bold">
            完成
          </button>
        </div>
      </div>
    </div>

    <!-- Handicap Input Modal -->
    <div v-if="showHandicapInput" class="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 backdrop-blur-sm px-6">
      <div class="w-full max-w-xs bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl">
        <div class="p-6 text-center">
          <div class="w-16 h-16 rounded-full mx-auto mb-3 border-2 border-orange-500 bg-slate-800 flex items-center justify-center text-2xl font-bold">
            {{ pendingHandicapPlayer?.nickname?.charAt(0) || '?' }}
          </div>
          <h3 class="text-lg font-bold mb-1">{{ pendingHandicapPlayer?.nickname || '未知' }}</h3>
          <p class="text-xs text-slate-500 mb-6">设置相对于老虎的受让杆数</p>
          
          <div class="flex items-center justify-center gap-6 mb-8">
            <button @click="handicapValue = Math.max(0, handicapValue - 1)" class="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
              <Minus class="w-6 h-6" />
            </button>
            <span class="text-4xl font-black text-orange-500">{{ handicapValue }}</span>
            <button @click="handicapValue++" class="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
              <Plus class="w-6 h-6" />
            </button>
          </div>

          <div class="flex gap-3">
            <button @click="showHandicapInput = false" class="flex-1 py-3 bg-slate-800 text-white rounded-xl font-bold">取消</button>
            <button @click="confirmHandicap" class="flex-1 py-3 bg-orange-600 text-white rounded-xl font-bold">确定</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Player Modal -->
    <div v-if="showAddPlayerModal" class="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showAddPlayerModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">添加球手</h2>
          <button @click="showAddPlayerModal = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <!-- Quick Add Panel -->
        <div class="p-4 bg-slate-800/30 border-b border-slate-800">
          <div class="flex items-center gap-2">
            <div class="flex-1 bg-slate-950 rounded-xl border border-slate-800 px-3 h-11 flex items-center focus-within:border-orange-500 transition-colors">
              <UserPlus class="w-4 h-4 text-slate-500 mr-2" />
              <input v-model="quickAddName" type="text" placeholder="输入昵称快速添加虚拟球手" 
                     class="flex-1 bg-transparent text-sm outline-none text-white" 
                     @keyup.enter="handleQuickAdd" />
            </div>
            <button @click="handleQuickAdd" 
                    class="h-11 px-5 bg-orange-600 text-white rounded-xl text-sm font-bold active:scale-95 transition-all shadow-lg shadow-orange-900/20">
              添加
            </button>
          </div>
        </div>
        
        <div class="p-4 grid grid-cols-2 gap-3 pb-10">
          <button v-for="opt in addPlayerOptions" :key="opt.id" 
                  @click="handleAddPlayerOption(opt.id)"
                  class="flex flex-col items-center justify-center gap-3 p-6 bg-slate-800/50 rounded-2xl border border-slate-800 hover:border-slate-700 active:scale-95 transition-all">
            <div class="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center shadow-inner">
              <component :is="opt.icon" :class="['w-6 h-6', opt.color]" />
            </div>
            <span class="text-xs font-medium text-slate-300">{{ opt.name }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- History Friends Modal -->
    <div v-if="showHistoryFriendsModal" class="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showHistoryFriendsModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300 h-[70vh] flex flex-col">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">历史同组好友</h2>
          <button @click="showHistoryFriendsModal = false" class="p-2 hover:bg-slate-800 rounded-full">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-3">
          <div v-if="historyFriends.length === 0" class="flex flex-col items-center justify-center py-20 text-slate-500">
            <Users class="w-12 h-12 mb-4 opacity-20" />
            <p class="text-sm">暂无历史同组好友</p>
          </div>
          <div v-for="friend in historyFriends" :key="friend.id" 
               @click="addHistoryFriend(friend)"
               class="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl border border-slate-800 active:bg-slate-800 transition-all cursor-pointer">
            <div class="flex items-center gap-3">
              <img :src="friend.avatar" class="w-10 h-10 rounded-full border border-slate-700" />
              <div>
                <div class="text-sm font-bold text-white">{{ friend.nickname }}</div>
                <div class="text-[10px] text-slate-500 mt-0.5">差点 {{ friend.handicap }}</div>
              </div>
            </div>
            <Plus class="w-5 h-5 text-blue-500" />
          </div>
        </div>
      </div>
    </div>

    <!-- QR Code Modal -->
    <div v-if="showQRCodeModal" class="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 backdrop-blur-md p-6" @click.self="showQRCodeModal = false">
      <div class="w-full max-w-xs bg-white rounded-[40px] p-8 flex flex-col items-center gap-6 animate-in zoom-in duration-300">
        <div class="text-center">
          <h3 class="text-lg font-black text-slate-900">比赛二维码</h3>
          <p class="text-xs text-slate-500 mt-1">扫码加入或围观比赛</p>
        </div>
        
        <div class="w-full aspect-square bg-slate-100 rounded-3xl flex items-center justify-center relative overflow-hidden p-4">
          <!-- Mock QR Code -->
          <div class="w-full h-full border-8 border-slate-200 rounded-2xl flex items-center justify-center relative">
            <QrCode class="w-3/4 h-3/4 text-slate-900" />
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="w-12 h-12 bg-white rounded-xl shadow-lg flex items-center justify-center">
                <img src="https://picsum.photos/100/100" class="w-10 h-10 rounded-lg" />
              </div>
            </div>
          </div>
        </div>

        <div class="w-full space-y-3">
          <button @click="simulateUserJoining({ id: 'qr_' + Date.now(), nickname: '扫码球友', avatar: 'https://picsum.photos/105/105', handicap: 15 })" 
                  class="w-full py-4 bg-blue-600 text-white rounded-full font-bold active:scale-95 transition-all">
            模拟扫码加入
          </button>
          <button @click="showQRCodeModal = false" class="w-full py-4 text-slate-400 font-bold text-sm">
            关闭
          </button>
        </div>
      </div>
    </div>

    <!-- Join/Spectate Choice Modal -->
    <div v-if="showJoinChoiceModal" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-xl p-6">
      <div class="w-full max-w-sm bg-slate-900 rounded-[40px] p-8 border border-slate-800 shadow-2xl flex flex-col items-center text-center animate-in zoom-in duration-300">
        <div class="w-20 h-20 rounded-full border-4 border-blue-500/30 p-1 mb-6">
          <img :src="joiningUser?.avatar" class="w-full h-full rounded-full object-cover" />
        </div>
        
        <h3 class="text-xl font-black text-white mb-2">{{ joiningUser?.nickname }}</h3>
        <p class="text-slate-400 text-sm mb-8">邀请你参与这场高尔夫球赛</p>
        
        <div class="w-full space-y-3">
          <button @click="handleJoinAsPlayer" class="w-full py-4 bg-blue-600 text-white rounded-full font-bold shadow-xl shadow-blue-900/20 active:scale-95 transition-all flex items-center justify-center gap-2">
            <UserPlus class="w-5 h-5" />
            加入比赛
          </button>
          <button @click="handleSpectate" class="w-full py-4 bg-slate-800 text-slate-300 rounded-full font-bold active:scale-95 transition-all flex items-center justify-center gap-2">
            <Eye class="w-5 h-5" />
            仅围观
          </button>
        </div>
      </div>
    </div>
    <!-- Player Action Modal -->
    <div v-if="showPlayerActionModal" class="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showPlayerActionModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-6 flex flex-col items-center border-b border-slate-800">
          <img :src="selectedPlayer?.avatar || `https://picsum.photos/seed/${selectedPlayer?.id}/100/100`" class="w-16 h-16 rounded-full border-2 border-slate-700 mb-3" />
          <h3 class="text-lg font-bold text-white">{{ selectedPlayer?.nickname }}</h3>
          <p class="text-xs text-slate-500 mt-1">差点: {{ selectedPlayer?.handicap }}</p>
        </div>
        
        <div class="p-4 space-y-3">
          <button @click="handleViewProfile" class="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-bold flex items-center justify-center gap-3 transition-colors">
            <User class="w-5 h-5 text-blue-400" />
            查看档案
          </button>
          
          <button v-if="isInitiator && selectedPlayer?.id !== '1'" 
                  @click="confirmDeletePlayer" 
                  class="w-full py-4 bg-red-900/20 hover:bg-red-900/30 text-red-500 rounded-2xl font-bold flex items-center justify-center gap-3 transition-colors">
            <Trash2 class="w-5 h-5" />
            删除参赛者
          </button>
          
          <button @click="showPlayerActionModal = false" class="w-full py-4 text-slate-500 font-bold text-sm">
            取消
          </button>
        </div>
      </div>
    </div>

    <div v-if="showVirtualPlayerPanel" class="fixed inset-0 z-[150] bg-slate-950 flex flex-col animate-in slide-in-from-bottom duration-300">
      <header class="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/50 backdrop-blur-md">
        <button @click="showVirtualPlayerPanel = false" class="p-2 -ml-2 hover:bg-slate-800 rounded-full transition-colors">
          <ChevronLeft class="w-6 h-6" />
        </button>
        <h1 class="text-base font-bold">添加虚拟球友</h1>
        <div class="w-10"></div>
      </header>
      
      <div class="p-6 space-y-8">
        <div class="flex flex-col items-center gap-4 py-8">
          <div class="w-24 h-24 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-3xl font-bold text-slate-500 shadow-inner">
            {{ quickAddName ? quickAddName.charAt(0) : '?' }}
          </div>
          <p class="text-xs text-slate-500">设置一个好记的昵称</p>
        </div>

        <div class="space-y-2">
          <label class="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">球友昵称</label>
          <div class="bg-slate-900 rounded-2xl border border-slate-800 p-1 focus-within:border-orange-500 transition-colors">
            <input 
              v-model="quickAddName" 
              type="text" 
              placeholder="请输入球友昵称" 
              class="w-full h-12 bg-transparent px-4 text-base outline-none text-white"
              autofocus
              @keyup.enter="handleQuickAdd"
            />
          </div>
        </div>

        <div class="pt-8">
          <button 
            @click="handleQuickAdd"
            :disabled="!quickAddName.trim()"
            class="w-full py-4 rounded-full font-bold text-base transition-all active:scale-95 shadow-xl"
            :class="quickAddName.trim() ? 'bg-orange-600 text-white shadow-orange-900/20' : 'bg-slate-800 text-slate-500 cursor-not-allowed'"
          >
            确认并添加
          </button>
          <button @click="showVirtualPlayerPanel = false" class="w-full py-4 mt-4 text-slate-400 font-medium text-sm">
            取消
          </button>
        </div>
      </div>
    </div>
    <!-- Settings Modal -->
    <div v-if="showSettingsModal" class="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showSettingsModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">比赛设置</h2>
          <button @click="showSettingsModal = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        
        <div class="p-4 space-y-3 pb-10">
          <button v-for="opt in settingsOptions" :key="opt.id" 
                  @click="handleSettingsAction(opt.action || '')"
                  class="w-full flex items-center gap-4 p-4 bg-slate-800/50 rounded-2xl border border-slate-800 hover:border-slate-700 active:scale-95 transition-all">
            <div class="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center shadow-inner">
              <component :is="opt.icon" :class="['w-5 h-5', opt.color]" />
            </div>
            <span class="text-sm font-medium text-slate-200">{{ opt.name }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Match Modal -->
    <div v-if="showEditMatchModal" class="fixed inset-0 z-[130] flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300 h-[80vh] flex flex-col">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">修改比赛</h2>
          <button @click="showEditMatchModal = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        
        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">比赛名称</label>
            <input v-model="editMatchTitle" type="text" class="w-full p-4 bg-slate-800 rounded-2xl border border-slate-700 focus:border-blue-500 outline-none text-white font-bold" />
          </div>

          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">比赛时间</label>
            <input v-model="editMatchTime" type="datetime-local" class="w-full p-4 bg-slate-800 rounded-2xl border border-slate-700 focus:border-blue-500 outline-none text-white font-bold" />
          </div>

          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">球场</label>
            <div @click="showEditCoursePicker = true" class="w-full p-4 bg-slate-800 rounded-2xl border border-slate-700 flex items-center justify-between cursor-pointer active:bg-slate-700">
              <span class="text-white font-bold">{{ editSelectedCourse?.name }}</span>
              <ChevronRight class="w-5 h-5 text-slate-500" />
            </div>
          </div>

          <div class="space-y-2">
            <label class="text-xs font-bold text-slate-500 uppercase tracking-wider">参与球员</label>
            <div class="space-y-2">
              <div v-for="player in matchStore.user_list" :key="player.id" class="flex items-center justify-between p-3 bg-slate-800/50 rounded-xl border border-slate-800">
                <div class="flex items-center gap-3">
                  <img :src="player.avatar" class="w-8 h-8 rounded-full" />
                  <span class="text-sm font-bold">{{ player.nickname }}</span>
                </div>
                <button @click="handleRemovePlayer(player)" class="p-2 text-red-500 hover:bg-red-500/10 rounded-lg">
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
              <button @click="showAddPlayerModal = true" class="w-full py-3 border-2 border-dashed border-slate-800 rounded-xl flex items-center justify-center gap-2 text-slate-500 hover:text-slate-300 hover:border-slate-700 transition-all">
                <Plus class="w-4 h-4" />
                <span class="text-xs font-bold">添加球员</span>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between p-4 bg-slate-800/50 rounded-2xl border border-slate-800">
            <div class="flex flex-col">
              <span class="text-sm font-bold">私密比赛</span>
              <span class="text-[10px] text-slate-500">开启后仅参与球员可见</span>
            </div>
            <input type="checkbox" v-model="editMatchPrivacy" class="w-5 h-5 accent-blue-500" />
          </div>
        </div>

        <div class="p-6 border-t border-slate-800">
          <button @click="saveMatchEdits" class="w-full py-4 bg-blue-600 text-white rounded-full font-bold shadow-lg shadow-blue-900/20 active:scale-95 transition-all">
            保存修改
          </button>
        </div>
      </div>
    </div>

    <!-- Edit Course Picker -->
    <div v-if="showEditCoursePicker" class="fixed inset-0 z-[140] flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300 h-[80vh] flex flex-col">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">选择球场</h2>
          <button @click="showEditCoursePicker = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-4">
          <div class="relative">
            <Search class="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" :size="18" />
            <input v-model="editSearchKey" type="text" placeholder="搜索球场..." class="w-full pl-12 pr-4 py-3 bg-slate-800 rounded-2xl border border-slate-700 outline-none text-white" />
          </div>
        </div>
        <div class="flex-1 overflow-y-auto p-4 space-y-2">
          <div v-for="course in filteredEditCourses" :key="course.name" @click="handleEditCourseSelect(course)" class="p-4 bg-slate-800/50 rounded-2xl border border-slate-800 flex items-center justify-between cursor-pointer active:bg-slate-800">
            <div>
              <div class="text-white font-bold">{{ course.name }}</div>
              <div class="text-[10px] text-slate-500">{{ course.city }} · {{ course.sections ? course.sections.length / 2 + '场' : '18洞' }}</div>
            </div>
            <ChevronRight class="w-4 h-4 text-slate-600" />
          </div>
        </div>
      </div>
    </div>

    <!-- Edit Section Picker -->
    <div v-if="showEditSectionPicker" class="fixed inset-0 z-[150] flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 class="text-base font-bold">选择半场</h2>
            <p class="text-[10px] text-slate-500 mt-0.5">请选择两个 9 洞半场进行组合</p>
          </div>
          <button @click="showEditSectionPicker = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-6 space-y-6">
          <div class="grid grid-cols-2 gap-3">
            <div v-for="section in editSelectedCourse?.sections" :key="section.name" @click="toggleEditSection(section)" class="p-4 rounded-2xl border-2 flex flex-col items-center gap-2 cursor-pointer transition-all" :class="editSelectedSections.find(s => s.name === section.name) ? 'border-blue-500 bg-blue-500/10' : 'border-slate-800 bg-slate-800/50'">
              <span class="font-bold text-white">{{ section.name }}</span>
              <span class="text-[10px] text-slate-500">Par {{ section.holes_par.reduce((a, b) => a + b, 0) }}</span>
              <div v-if="editSelectedSections.findIndex(s => s.name === section.name) > -1" class="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-[10px] font-bold">
                {{ editSelectedSections.findIndex(s => s.name === section.name) + 1 }}
              </div>
            </div>
          </div>
          <button @click="confirmEditSections" :disabled="editSelectedSections.length !== 2" class="w-full py-4 rounded-full font-bold transition-all" :class="editSelectedSections.length === 2 ? 'bg-blue-600 text-white active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'">
            确认组合 ({{ editSelectedSections.length }}/2)
          </button>
        </div>
      </div>
    </div>

    <!-- Landmine Modal -->
    <div v-if="showLandmineModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/80 backdrop-blur-sm" @click.self="showLandmineModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">埋地雷设置</h2>
          <button @click="showLandmineModal = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-6 space-y-8 pb-12">
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-sm">前九地雷数</span>
              <div class="flex items-center gap-4">
                <button @click="currentConfigRule?.landmines && (currentConfigRule.landmines.front = Math.max(0, currentConfigRule.landmines.front - 1))" class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center"><Minus class="w-4 h-4" /></button>
                <span class="text-lg font-bold w-4 text-center">{{ currentConfigRule?.landmines?.front || 0 }}</span>
                <button @click="currentConfigRule?.landmines && (currentConfigRule.landmines.front = Math.min(9, currentConfigRule.landmines.front + 1))" class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center"><Plus class="w-4 h-4" /></button>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm">后九地雷数</span>
              <div class="flex items-center gap-4">
                <button @click="currentConfigRule?.landmines && (currentConfigRule.landmines.back = Math.max(0, currentConfigRule.landmines.back - 1))" class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center"><Minus class="w-4 h-4" /></button>
                <span class="text-lg font-bold w-4 text-center">{{ currentConfigRule?.landmines?.back || 0 }}</span>
                <button @click="currentConfigRule?.landmines && (currentConfigRule.landmines.back = Math.min(9, currentConfigRule.landmines.back + 1))" class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center"><Plus class="w-4 h-4" /></button>
              </div>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm">地雷翻倍数</span>
              <div class="flex items-center gap-4">
                <button @click="currentConfigRule?.landmines && (currentConfigRule.landmines.multiplier = Math.max(2, currentConfigRule.landmines.multiplier - 1))" class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center"><Minus class="w-4 h-4" /></button>
                <span class="text-lg font-bold w-4 text-center">{{ currentConfigRule?.landmines?.multiplier || 2 }}</span>
                <button @click="currentConfigRule?.landmines && (currentConfigRule.landmines.multiplier++)" class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center"><Plus class="w-4 h-4" /></button>
              </div>
            </div>
          </div>
          <button @click="randomizeLandmines(); showLandmineModal = false" class="w-full py-4 bg-red-600 text-white rounded-full font-bold shadow-lg shadow-red-900/20 active:scale-95 transition-all">
            随机分配地雷并确认
          </button>
        </div>
      </div>
    </div>

    <!-- Participant Modal -->
    <div v-if="showParticipantModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/80 backdrop-blur-sm" @click.self="showParticipantModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">选择参与人数</h2>
          <button @click="showParticipantModal = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-4 space-y-2 pb-10">
          <button v-for="n in [2, 3, 4]" :key="n" 
                  @click="currentConfigRule && (currentConfigRule.participant_count = n); showParticipantModal = false"
                  class="w-full p-4 rounded-2xl flex items-center justify-between transition-all"
                  :class="currentConfigRule?.participant_count === n ? 'bg-orange-600/20 border border-orange-500' : 'bg-slate-800/50 border border-slate-800'">
            <span class="font-bold">{{ n }}人单挂</span>
            <div v-if="currentConfigRule?.participant_count === n" class="w-2 h-2 rounded-full bg-orange-500"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Handicap Modal -->
    <div v-if="showHandicapModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/80 backdrop-blur-sm" @click.self="showHandicapModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">单让规则设置</h2>
          <button @click="showHandicapModal = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-4 space-y-2 pb-10 max-h-[60vh] overflow-y-auto">
          <button v-for="opt in ['none', '2', '3', '4', '5', 'virtual']" :key="opt" 
                  @click="currentConfigRule?.handicap_config && (currentConfigRule.handicap_config.type = opt); showHandicapModal = false; if(opt === 'none') showHandicapValueModal = true"
                  class="w-full p-4 rounded-2xl flex items-center justify-between transition-all"
                  :class="currentConfigRule?.handicap_config?.type === opt ? 'bg-orange-600/20 border border-orange-500' : 'bg-slate-800/50 border border-slate-800'">
            <span class="font-bold">{{ opt === 'none' ? '总分让杆' : opt === 'virtual' ? '虚让' : opt + '让1' }}</span>
            <div v-if="currentConfigRule?.handicap_config?.type === opt" class="w-2 h-2 rounded-full bg-orange-500"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Total Handicap Modal (for 8421) -->
    <div v-if="showTotalHandicapModal" class="fixed inset-0 z-[170] flex items-center justify-center bg-black/80 backdrop-blur-sm px-6">
      <div class="w-full max-w-xs bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl">
        <div class="p-6">
          <h3 class="text-lg font-bold mb-6 text-center">设置总分让分</h3>
          <div class="flex items-center justify-center gap-6 mb-8">
            <button @click="currentConfigRule && currentConfigRule.handicap_config && (currentConfigRule.handicap_config.value = Math.max(0, currentConfigRule.handicap_config.value - 1))" 
                    class="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 active:scale-95 transition-all">
              <Minus class="w-6 h-6" />
            </button>
            <span class="text-3xl font-black w-16 text-center text-orange-500">{{ currentConfigRule?.handicap_config?.value || 0 }}</span>
            <button @click="currentConfigRule && currentConfigRule.handicap_config && (currentConfigRule.handicap_config.value += 1)" 
                    class="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700 active:scale-95 transition-all">
              <Plus class="w-6 h-6" />
            </button>
          </div>
          <button @click="showTotalHandicapModal = false" class="w-full py-3 bg-orange-600 text-white rounded-xl font-bold">
            确定
          </button>
        </div>
      </div>
    </div>

    <!-- Par-specific Handicap Modal -->
    <div v-if="showParHandicapModal" class="fixed inset-0 z-[170] flex items-center justify-center bg-black/80 backdrop-blur-sm px-6">
      <div class="w-full max-w-xs bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl">
        <div class="p-6">
          <h3 class="text-lg font-bold mb-6 text-center">设置让杆</h3>
          <div class="space-y-6">
            <div v-for="par in [3, 4, 5]" :key="par" class="flex items-center justify-between">
              <span class="text-sm font-bold">Par {{ par }} 让杆</span>
              <div class="flex items-center gap-4">
                <button @click="currentConfigRule.handicap_par_strokes[`par${par}`] = Math.max(0, currentConfigRule.handicap_par_strokes[`par${par}`] - 0.5)" 
                        class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                  <Minus class="w-4 h-4" />
                </button>
                <span class="text-lg font-bold w-10 text-center text-orange-500">{{ currentConfigRule.handicap_par_strokes[`par${par}`] }}</span>
                <button @click="currentConfigRule.handicap_par_strokes[`par${par}`] += 0.5" 
                        class="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
                  <Plus class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
          <button @click="showParHandicapModal = false" class="w-full py-3 bg-orange-600 text-white rounded-xl font-bold mt-8 shadow-lg shadow-orange-900/20">确定</button>
        </div>
      </div>
    </div>

    <!-- Starting Hole Modal -->
    <div v-if="showStartingHoleModal" class="fixed inset-0 z-[170] flex items-center justify-center bg-black/80 backdrop-blur-sm px-6">
      <div class="w-full max-w-xs bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl">
        <div class="p-6">
          <h3 class="text-lg font-bold mb-6 text-center">选择出发洞</h3>
          <div class="grid grid-cols-6 gap-2">
            <button v-for="i in 18" :key="i"
                    @click="currentConfigRule.starting_hole = i; showStartingHoleModal = false"
                    class="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold transition-all"
                    :class="currentConfigRule.starting_hole === i ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'">
              {{ i }}
            </button>
          </div>
          <button @click="showStartingHoleModal = false" class="w-full py-3 bg-slate-800 text-white rounded-xl font-bold mt-6">取消</button>
        </div>
      </div>
    </div>

    <!-- Hole-based Handicap Modal -->
    <div v-if="showHoleHandicapModal" class="fixed inset-0 z-[170] flex items-center justify-center bg-black/80 backdrop-blur-sm px-6">
      <div class="w-full max-w-xs bg-slate-900 rounded-3xl overflow-hidden border border-slate-800 shadow-2xl">
        <div class="p-6 text-center">
          <h3 class="text-lg font-bold mb-1">设置让洞</h3>
          <p class="text-xs text-slate-500 mb-6">输入让洞数量</p>
          
          <div class="flex items-center justify-center gap-6 mb-8">
            <button @click="currentConfigRule.handicap_holes_count = Math.max(0, currentConfigRule.handicap_holes_count - 1)" class="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
              <Minus class="w-6 h-6" />
            </button>
            <span class="text-4xl font-black text-orange-500">{{ currentConfigRule.handicap_holes_count }}</span>
            <button @click="currentConfigRule.handicap_holes_count++" class="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center border border-slate-700">
              <Plus class="w-6 h-6" />
            </button>
          </div>

          <button @click="showHoleHandicapModal = false" class="w-full py-3 bg-orange-600 text-white rounded-xl font-bold">确定</button>
        </div>
      </div>
    </div>

    <!-- Reward Modal -->
    <div v-if="showRewardModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/80 backdrop-blur-sm" @click.self="showRewardModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">奖励规则设置</h2>
          <button @click="showRewardModal = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-4 space-y-2 pb-10">
          <button v-for="opt in ['1', '2', '3', '4']" :key="opt" 
                  @click="currentConfigRule && (currentConfigRule.reward_config = opt); showRewardModal = false"
                  class="w-full p-4 rounded-2xl flex items-center justify-between transition-all"
                  :class="currentConfigRule?.reward_config === opt ? 'bg-orange-600/20 border border-orange-500' : 'bg-slate-800/50 border border-slate-800'">
            <span class="font-bold text-sm">{{ getRewardText(opt) }}</span>
            <div v-if="currentConfigRule?.reward_config === opt" class="w-2 h-2 rounded-full bg-orange-500"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Strokes Player Selection Modal -->
    <div v-if="showStrokesPlayerSelect" class="fixed inset-0 z-[170] flex items-end justify-center bg-black/80 backdrop-blur-sm" @click.self="showStrokesPlayerSelect = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">选择选手 {{ strokesSelectIndex + 1 }}</h2>
          <button @click="showStrokesPlayerSelect = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-4 max-h-[60vh] overflow-y-auto">
          <div class="grid grid-cols-4 gap-4">
            <button v-for="player in players" :key="player.id" 
                    @click="handleStrokesPlayerSelect(player)"
                    class="flex flex-col items-center gap-2 p-2 rounded-xl transition-all"
                    :class="currentConfigRule?.player_ids?.[strokesSelectIndex] === player.id ? 'bg-orange-500/20 ring-1 ring-orange-500' : 'hover:bg-slate-800'">
              <div class="w-12 h-12 rounded-full border-2 border-slate-700 bg-slate-800 flex items-center justify-center text-lg font-bold">
                {{ player.nickname.charAt(0) }}
              </div>
              <span class="text-[10px] font-medium truncate w-full text-center">{{ player.nickname }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Win Condition Modal -->
    <div v-if="showWinConditionModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/80 backdrop-blur-sm" @click.self="showWinConditionModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">选择赢洞条件</h2>
          <button @click="showWinConditionModal = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-4 space-y-2 pb-10">
          <button @click="currentConfigRule && (currentConfigRule.win_condition = 'lower_strokes'); showWinConditionModal = false"
                  class="w-full p-4 rounded-2xl flex items-center justify-between transition-all"
                  :class="currentConfigRule?.win_condition === 'lower_strokes' ? 'bg-orange-600/20 border border-orange-500' : 'bg-slate-800/50 border border-slate-800'">
            <span class="font-bold">杆数少者算赢</span>
            <div v-if="currentConfigRule?.win_condition === 'lower_strokes'" class="w-2 h-2 rounded-full bg-orange-500"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Tie Modal -->
    <div v-if="showTieModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/80 backdrop-blur-sm" @click.self="showTieModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">顶洞规则</h2>
          <button @click="showTieModal = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-4 space-y-2 pb-10">
          <button @click="currentConfigRule && (currentConfigRule.tie_type = 'add_one'); showTieModal = false"
                  class="w-full p-4 rounded-2xl flex items-center justify-between transition-all"
                  :class="currentConfigRule?.tie_type === 'add_one' ? 'bg-orange-600/20 border border-orange-500' : 'bg-slate-800/50 border border-slate-800'">
            <span class="font-bold">下洞加1分</span>
            <div v-if="currentConfigRule?.tie_type === 'add_one'" class="w-2 h-2 rounded-full bg-orange-500"></div>
          </button>
          <button @click="currentConfigRule && (currentConfigRule.tie_type = 'none'); showTieModal = false"
                  class="w-full p-4 rounded-2xl flex items-center justify-between transition-all"
                  :class="currentConfigRule?.tie_type === 'none' ? 'bg-orange-600/20 border border-orange-500' : 'bg-slate-800/50 border border-slate-800'">
            <span class="font-bold">不加分</span>
            <div v-if="currentConfigRule?.tie_type === 'none'" class="w-2 h-2 rounded-full bg-orange-500"></div>
          </button>
        </div>
      </div>
    </div>

    <!-- Collect Tie Modal -->
    <div v-if="showCollectTieModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/80 backdrop-blur-sm" @click.self="showCollectTieModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">收顶洞规则</h2>
          <button @click="showCollectTieModal = false" class="p-2 hover:bg-slate-800 rounded-full transition-colors">
            <X class="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div class="p-4 space-y-2 pb-10">
          <button @click="currentConfigRule && (currentConfigRule.collect_tie_type = 'par_1_birdie_2_eagle_all'); showCollectTieModal = false"
                  class="w-full p-4 rounded-2xl flex items-center justify-between transition-all"
                  :class="currentConfigRule?.collect_tie_type === 'par_1_birdie_2_eagle_all' ? 'bg-orange-600/20 border border-orange-500' : 'bg-slate-800/50 border border-slate-800'">
            <span class="font-bold">帕收1/鸟收2/鹰全收</span>
            <div v-if="currentConfigRule?.collect_tie_type === 'par_1_birdie_2_eagle_all'" class="w-2 h-2 rounded-full bg-orange-500"></div>
          </button>
          <button @click="currentConfigRule && (currentConfigRule.collect_tie_type = 'all'); showCollectTieModal = false"
                  class="w-full p-4 rounded-2xl flex items-center justify-between transition-all"
                  :class="currentConfigRule?.collect_tie_type === 'all' ? 'bg-orange-600/20 border border-orange-500' : 'bg-slate-800/50 border border-slate-800'">
            <span class="font-bold">全收</span>
            <div v-if="currentConfigRule?.collect_tie_type === 'all'" class="w-2 h-2 rounded-full bg-orange-500"></div>
          </button>
        </div>
      </div>
    </div>
    <!-- Hole Select Modal -->
    <div v-if="showHoleSelectModal" class="fixed inset-0 z-[160] flex items-end justify-center bg-black/80 backdrop-blur-sm" @click.self="showHoleSelectModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <h2 class="text-base font-bold">选择有效洞</h2>
          <div class="flex gap-2">
            <button @click="setHoleRange('front')" class="text-[10px] px-2 py-1 bg-slate-800 rounded">前九</button>
            <button @click="setHoleRange('back')" class="text-[10px] px-2 py-1 bg-slate-800 rounded">后九</button>
            <button @click="setHoleRange('all')" class="text-[10px] px-2 py-1 bg-slate-800 rounded">全选</button>
          </div>
        </div>
        <div class="p-6 pb-12">
          <div class="grid grid-cols-6 gap-3">
            <button v-for="i in 18" :key="i" 
                    @click="toggleHole(i)"
                    class="aspect-square rounded-xl flex items-center justify-center text-sm font-bold transition-colors"
                    :class="currentConfigRule?.valid_holes?.includes(i) ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-500'">
              {{ i }}
            </button>
          </div>
          <button @click="showHoleSelectModal = false" class="w-full py-4 bg-slate-800 text-white rounded-full font-bold mt-8">
            完成
          </button>
        </div>
      </div>
    </div>

    <!-- PK Score Modal -->
    <div v-if="showPKScoreModal" class="fixed inset-0 z-[160] flex flex-col bg-slate-900 text-slate-100 animate-in slide-in-from-bottom duration-300">
      <!-- Header -->
      <div class="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 gap-4">
        <div class="flex-1 relative">
          <select v-model="selectedPKRuleId" class="w-full bg-blue-600 text-white font-bold py-3 px-4 rounded-full appearance-none text-center text-sm outline-none shadow-lg shadow-blue-900/20">
            <option value="all">得分汇总</option>
            <option v-for="rule in matchStore.activeRules" :key="rule.id" :value="rule.id">
              {{ getRuleDisplayName(rule) }}
            </option>
          </select>
          <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-white">
            <svg class="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
          </div>
        </div>
        <button @click="showPKScoreModal = false" class="px-4 py-3 bg-slate-100 text-slate-900 rounded-full font-bold text-sm flex items-center gap-1 shrink-0">
          <X class="w-4 h-4" /> 关闭
        </button>
      </div>

      <!-- Score Table -->
      <div class="flex-1 overflow-auto bg-slate-950">
        <table class="w-full border-collapse table-fixed">
          <thead class="sticky top-0 bg-slate-900 z-40 shadow-sm">
            <tr>
              <th class="w-16 p-2 border-b border-r border-slate-800 bg-slate-800/30">
                <div class="text-[10px] text-slate-400">累计</div>
              </th>
              <th v-for="player in players" :key="player.id" class="p-2 border-b border-r border-slate-800 bg-slate-900">
                <div class="flex flex-col items-center">
                  <img :src="player.avatar" class="w-8 h-8 rounded-full mb-1 object-cover border border-slate-700" />
                  <span class="text-[10px] font-bold truncate w-full text-center">{{ player.nickname }}</span>
                </div>
              </th>
            </tr>
            <tr>
              <th class="p-2 border-b border-r border-slate-800 bg-slate-800/30">
                <div class="text-[10px] text-slate-400">总分</div>
              </th>
              <th v-for="player in players" :key="'total-'+player.id" class="p-2 border-b border-r border-slate-800 bg-slate-900/80">
                <div class="text-sm font-bold" :class="getPKScoreTotal(player.id) >= 0 ? 'text-red-400' : 'text-green-400'">
                  {{ getPKScoreTotal(player.id) > 0 ? '+' : '' }}{{ getPKScoreTotal(player.id) }}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in 18" :key="i">
              <td class="p-2 border-b border-r border-slate-800 text-center font-mono text-xs text-slate-400 bg-slate-800/10">
                {{ i }}
              </td>
              <td v-for="player in players" :key="player.id" class="p-2 border-b border-r border-slate-800 text-center font-mono text-xs">
                <span v-if="getPKScoreHole(player.id, i-1) !== 0" :class="getPKScoreHole(player.id, i-1) > 0 ? 'text-red-400' : 'text-green-400'">
                  {{ getPKScoreHole(player.id, i-1) > 0 ? '+' : '' }}{{ getPKScoreHole(player.id, i-1) }}
                </span>
                <span v-else class="text-slate-600">0</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <!-- Share Modal -->
    <div v-if="showShareModal" class="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showShareModal = false">
      <div class="w-full max-w-lg bg-slate-900 rounded-t-3xl overflow-hidden animate-in slide-in-from-bottom duration-300">
        <div class="p-8 grid grid-cols-2 gap-8">
          <button @click="showShareModal = false" class="flex flex-col items-center gap-3 group">
            <div class="w-16 h-16 rounded-2xl bg-green-600 flex items-center justify-center shadow-lg shadow-green-900/20 group-active:scale-90 transition-transform">
              <MessageCircle class="w-8 h-8 text-white" />
            </div>
            <span class="text-xs font-bold text-slate-300">微信好友</span>
          </button>
          <button @click="showShareModal = false" class="flex flex-col items-center gap-3 group">
            <div class="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-900/20 group-active:scale-90 transition-transform">
              <Users class="w-8 h-8 text-white" />
            </div>
            <span class="text-xs font-bold text-slate-300">朋友圈</span>
          </button>
        </div>
        <div class="p-4 border-t border-slate-800">
          <button @click="showShareModal = false" class="w-full py-4 text-slate-400 font-bold text-sm">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-in {
  animation: animate-in 0.3s ease-out;
}

@keyframes animate-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

.slide-in-from-bottom {
  animation: slide-in-from-bottom 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes slide-in-from-bottom {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

/* Hide scrollbar but keep functionality */
::-webkit-scrollbar {
  display: none;
}

table {
  border-spacing: 0;
}

th, td {
  white-space: nowrap;
}
</style>
