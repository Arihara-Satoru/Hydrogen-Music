import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate  from 'pinia-plugin-persistedstate'
import { selectedPersistence } from './selectedPersistence'

const pinia = createPinia()
const app = createApp()

pinia.use(piniaPluginPersistedstate)
pinia.use(selectedPersistence)
app.use(pinia)

export default pinia
