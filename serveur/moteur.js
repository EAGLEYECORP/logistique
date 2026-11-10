"use strict";
/* Moteur de calcul partagé avec l'application : les fonctions de gps.js (états, ETA…) sont chargées telles quelles,
   pour que le lien client et l'application donnent le même résultat. Nécessite data.js, noyau.js, adm.js et gps.js à la racine du dépôt. */
const vm = require("vm");
const fs = require("fs");
const path = require("path");

function charger(racine = path.join(__dirname, "..")) {
  const ctx = vm.createContext({ console, Math, Date, Set, Number, String, JSON, Uint8Array, TextEncoder, TextDecoder, setTimeout, clearTimeout });
  try { for (const f of ["data.js", "noyau.js", "adm.js", "gps.js"]) vm.runInContext(fs.readFileSync(path.join(racine, f), "utf8"), ctx, { filename: f }); }
  catch (e) { return { disponible: false, erreur: e.message, appeler: () => null }; }
  return {
    disponible: true,
    /** Appelle une fonction de gps.js avec des arguments JSON ; renvoie un résultat JSON. */
    appeler(nom, ...args) { ctx.__args = JSON.stringify(args); return JSON.parse(vm.runInContext(`JSON.stringify(${nom}(...JSON.parse(__args)))`, ctx) ?? "null"); },
  };
}
module.exports = { charger };
