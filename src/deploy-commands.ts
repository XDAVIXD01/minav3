import { REST, Routes } from "discord.js";
import { credentials } from "./config.js";
import { readerCommand } from "./commands.js";

const { token, clientId, guildId } = credentials();
const rest = new REST({ version: "10" }).setToken(token);
// Upsert solo /leer: mantiene los comandos de minav2 en la misma aplicación.
await rest.post(guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId), { body: readerCommand });
console.log("Comando /leer registrado; los otros comandos se conservaron.");
