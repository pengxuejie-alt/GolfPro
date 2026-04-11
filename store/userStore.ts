import { defineStore } from 'pinia';

export interface UserProfile {
  nickname: string;
  avatar: string;
  gender: 'male' | 'female';
  handicap: number;
}

export const useUserStore = defineStore('user', {
  state: () => ({
    profile: {
      nickname: '犬神Rocky',
      avatar: 'https://picsum.photos/seed/rocky/200/200',
      gender: 'male',
      handicap: 12.5
    } as UserProfile
  }),
  actions: {
    updateProfile(newProfile: Partial<UserProfile>) {
      this.profile = { ...this.profile, ...newProfile };
    }
  }
});
