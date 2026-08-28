import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    // The client suites import host UI packages whose lib pulls .module.css;
    // left external, Node itself would choke on the extension.
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
