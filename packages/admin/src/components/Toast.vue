<script setup lang="ts">
import { toastState } from "../toast";
</script>

<template>
  <div class="toast-zone" aria-live="polite">
    <div v-for="t in toastState.items" :key="t.id" class="toast" :class="`toast-${t.kind}`">
      {{ t.text }}
    </div>
  </div>
</template>
