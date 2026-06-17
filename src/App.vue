<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <main class="min-h-screen bg-gray-100 text-gray-900 w-full flex flex-col">
    <RouterView />
  </main>
</template>

<style>
body {
  margin: 0;
  padding: 0;
  display: block;
  min-height: 100vh;
  width: 100%;
}
#app {
  max-width: none;
  margin: 0;
  padding: 0;
}
</style>
