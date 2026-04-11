<script setup lang="ts">
import { ref, computed } from 'vue';
import Home from './pages/Home.vue';
import CreateMatch from './pages/CreateMatch.vue';
import Scorecard from './pages/Scorecard.vue';
import PKSet from './pages/PKSet.vue';
import SelectPlayer from './pages/SelectPlayer.vue';
import Players from './pages/Players.vue';
import Me from './pages/Me.vue';
import PlayerProfile from './pages/PlayerProfile.vue';
import PKDizhu from './pages/PKDizhu.vue';
import PKTiger from './pages/PKTiger.vue';
import PKLashi from './pages/PKLashi.vue';
import MatchSquare from './pages/MatchSquare.vue';
import { Home as HomeIcon, Users, User } from 'lucide-vue-next';
import { Tab } from './types';

const currentTab = ref<Tab>(Tab.HOME);
const navigationParams = ref<any>(null);

const currentComponent = computed(() => {
  switch (currentTab.value) {
    case Tab.HOME:
      return Home;
    case Tab.CREATE:
      return CreateMatch;
    case Tab.SCORECARD:
      return Scorecard;
    case Tab.PK_SET:
      return PKSet;
    case Tab.SELECT_PLAYER:
      return SelectPlayer;
    case Tab.PLAYERS:
      return Players;
    case Tab.ME:
      return Me;
    case Tab.PLAYER_PROFILE:
      return PlayerProfile;
    case Tab.PK_DIZHU:
      return PKDizhu;
    case Tab.PK_TIGER:
      return PKTiger;
    case Tab.PK_LASHI:
      return PKLashi;
    case Tab.MATCH_SQUARE:
      return MatchSquare;
    default:
      return Home;
  }
});

const showTabBar = computed(() => [Tab.HOME, Tab.PLAYERS, Tab.ME].includes(currentTab.value));

const navigate = (tab: Tab, params?: any) => {
  console.log('Navigating to:', tab, 'with params:', params);
  currentTab.value = tab;
  navigationParams.value = params;
};

const backToHome = () => {
  currentTab.value = Tab.HOME;
  navigationParams.value = null;
};
</script>

<template>
  <div class="relative w-full h-full overflow-hidden">
    <!-- Dynamic Component for Content -->
    <component 
      :is="currentComponent" 
      :params="navigationParams"
      @navigate="navigate" 
      @back="backToHome" 
    />

    <!-- Bottom Tab Bar (Only on Home) -->
    <div v-if="showTabBar" class="fixed bottom-0 w-full max-w-md bg-white border-t border-slate-100 px-6 py-3 pb-6 pb-safe flex justify-between items-center z-40">
      <button 
        class="flex flex-col items-center gap-1 transition-colors"
        :class="currentTab === Tab.HOME ? 'text-lime-600' : 'text-slate-400'"
        @click="navigate(Tab.HOME)"
      >
        <HomeIcon :size="24" :fill="currentTab === Tab.HOME ? 'currentColor' : 'none'" :class="currentTab === Tab.HOME ? 'opacity-20' : ''" />
        <span class="text-xs font-bold">首页</span>
      </button>
      
      <button 
        class="flex flex-col items-center gap-1 transition-colors"
        :class="currentTab === Tab.PLAYERS ? 'text-lime-600' : 'text-slate-400'"
        @click="navigate(Tab.PLAYERS)"
      >
        <Users :size="24" :fill="currentTab === Tab.PLAYERS ? 'currentColor' : 'none'" :class="currentTab === Tab.PLAYERS ? 'opacity-20' : ''" />
        <span class="text-xs font-medium">球友</span>
      </button>

      <button 
        class="flex flex-col items-center gap-1 transition-colors"
        :class="currentTab === Tab.ME ? 'text-lime-600' : 'text-slate-400'"
        @click="navigate(Tab.ME)"
      >
        <User :size="24" :fill="currentTab === Tab.ME ? 'currentColor' : 'none'" :class="currentTab === Tab.ME ? 'opacity-20' : ''" />
        <span class="text-xs font-medium">我的</span>
      </button>
    </div>
  </div>
</template>

<style>
/* Global styles are in index.css */
</style>
