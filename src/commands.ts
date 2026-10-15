import { SlashCommandBuilder } from "discord.js";

export const readerCommand = new SlashCommandBuilder().setName("leer")
  .setDescription("Lee este chat en tu canal de voz con la voz IA de MINA")
  .addSubcommand(s => s.setName("iniciar").setDescription("Conecta a MINA y activa la lectura"))
  .addSubcommand(s => s.setName("detener").setDescription("Desconecta a MINA y vacía la cola"))
  .addSubcommand(s => s.setName("saltar").setDescription("Interrumpe el mensaje actual"))
  .addSubcommand(s => s.setName("limpiar").setDescription("Vacía los mensajes pendientes"))
  .addSubcommand(s => s.setName("estado").setDescription("Muestra el motor de voz y la cola"))
  .toJSON();
