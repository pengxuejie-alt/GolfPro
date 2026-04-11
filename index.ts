import { createApp, h } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import './index.css';

// Mock wx and uni for browser environment
if (typeof (window as any).wx === 'undefined') {
  const storageMock = {
    getStorageSync: (key: string) => {
      try {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : '';
      } catch (e) {
        return '';
      }
    },
    setStorageSync: (key: string, data: any) => {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch (e) {}
    },
    showToast: (options: any) => {
      console.log('Toast:', options.title);
    },
    showModal: (options: any) => {
      const confirmed = window.confirm(options.title + '\n' + (options.content || ''));
      if (confirmed && options.success) options.success({ confirm: true });
    }
  };
  (window as any).wx = storageMock;
  (window as any).uni = storageMock;
}

const app = createApp(App);

// Global components to mimic Mini Program tags
app.component('view', {
  render() {
    return h('div', this.$attrs, this.$slots);
  }
});

app.component('image', {
  props: ['src', 'mode'],
  render() {
    return h('img', { 
      src: this.src, 
      class: ['object-cover', this.$attrs.class],
      style: this.mode === 'aspectFill' ? { objectFit: 'cover' } : {}
    });
  }
});

const pinia = createPinia();

app.use(pinia);
app.mount('#root');
