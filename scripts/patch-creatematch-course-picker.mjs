import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const file = path.join(root, 'src/pages/CreateMatch.vue');
let s = execSync('git show 0dacbeb:src/pages/CreateMatch.vue', { encoding: 'utf8', cwd: root });

// imports
s = s.replace(
  "import { courseCatalogData, courseCatalogStats } from '@/data/courseCatalog';",
  "import { flattenCoursesForPicker } from '@/data/courseCatalog';",
);
s = s.replace(
  "import { sortCoursesForPicker } from '@/utils/coursePickerSort';\n",
  '',
);
s = s.replace(
  "import { getPickerLocationSync, resolvePickerLocation } from '@/utils/deviceLocationCache';\n",
  '',
);
s = s.replace(
  "import MpPrivacyGateModal from '@/components/MpPrivacyGateModal.vue';",
  "import MpPrivacyGateModal from '@/components/MpPrivacyGateModal.vue';\nimport CreateMatchCoursePicker from '@/components/CreateMatchCoursePicker.vue';",
);

// remove course picker script block
s = s.replace("const searchKey = ref('');\n", '');

const blockStart = s.indexOf('/** 小程序 scroll-view');
const blockEnd = s.indexOf('/** 半场组合弹层');
if (blockStart < 0 || blockEnd < 0) throw new Error('picker block markers not found');
const insert = `const publishBtnLabel = computed(() => (isEditMode.value ? '保存修改' : '发布并开球'));
const allCoursesFlat = flattenCoursesForPicker();

`;
s = s.slice(0, blockStart) + insert + s.slice(blockEnd);

// back icon color
s = s.replace('color="#1e293b"', 'color="#334155"');

// publish button
s = s.replace(
  "{{ isEditMode ? '保存修改' : '发布并开球' }}",
  '{{ publishBtnLabel }}',
);

// replace course picker template
const tplStart = s.indexOf('    <!-- Course Picker Modal -->');
const tplEnd = s.indexOf('    <!-- DateTime Picker Modal -->');
if (tplStart < 0 || tplEnd < 0) throw new Error('template markers not found');
const pickerTpl = `    <CreateMatchCoursePicker
      :show="showCoursePicker"
      @close="showCoursePicker = false"
      @select="selectCourse"
    />

`;
s = s.slice(0, tplStart) + pickerTpl + s.slice(tplEnd);

fs.writeFileSync(file, s, 'utf8');
console.log('patched', file, 'bytes', s.length);
