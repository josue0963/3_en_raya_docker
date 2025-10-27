// --- Importar Firebase SDKs ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// --- Configuración de Firebase ---
const firebaseConfig = {
  apiKey: "AIzaSyAr5HCcP_CnoKcksouAoUP8swoHT31CmRA",
  authDomain: "juego-mesa-cloud-5e038.firebaseapp.com",
  projectId: "juego-mesa-cloud-5e038",
  storageBucket: "juego-mesa-cloud-5e038.appspot.com",
  messagingSenderId: "975459755107",
  appId: "1:975459755107:web:280ad5e5f6fbc9ab1f4456",
  measurementId: "G-DBKTP9NSRF"
};

// --- Inicialización ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Estado local
let partidaActual = null;
let ultimoJugadores = null;
let turnoLocal = null;   // 'X' o 'O' según el usuario local
let tablero = Array(9).fill("");
let lineGanadora = null;
const winCombinations = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

// Referencias DOM
const gamePlaceholder = document.querySelector(".game-placeholder");
const partidaDetallesDiv = document.getElementById("partidaDetalles");
const resetContainer = document.getElementById("resetContainer");
const volverBtn = document.getElementById("btnVolverJugar");
const codigoInputContainer = document.querySelector("#codigoPartidaInput").parentElement;

// ----- Crear contenedor del tablero -----
const boardDiv = document.createElement("div");
boardDiv.className = "board-grid";
boardDiv.style.display = "none"; 
gamePlaceholder.innerHTML = "";  
gamePlaceholder.appendChild(boardDiv);

// ----- Inicializar tablero vacío -----
function initEmptyBoard() {
  tablero = Array(9).fill("");
  lineGanadora = null;
  renderTableroUI();
  boardDiv.style.display = "none";
  resetContainer.style.display = "none";
}
initEmptyBoard();

// ----- Renderizar tablero -----
function renderTableroUI() {
  boardDiv.innerHTML = "";
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.index = i;

    const val = tablero[i];
    if (val) {
      cell.textContent = val;
      cell.classList.add(val.toLowerCase());
      cell.classList.add("disabled");
    }

    if (lineGanadora && lineGanadora.includes(i)) {
      cell.classList.add("win");
    }

    if (!val && !lineGanadora) {
      cell.addEventListener("click", () => handleCellClick(i));
    }

    boardDiv.appendChild(cell);
  }
}

// ----- Calcular ganador -----
function computeWinner(boardArr) {
  for (const combo of winCombinations) {
    const [a,b,c] = combo;
    if (boardArr[a] && boardArr[a] === boardArr[b] && boardArr[a] === boardArr[c]) {
      return combo;
    }
  }
  return null;
}

// ----- Manejo de click en celda -----
async function handleCellClick(index) {
  const user = auth.currentUser;
  if (!user) return alert("Debes iniciar sesión para jugar.");
  if (!partidaActual) return alert("Debes estar dentro de una partida.");

  try {
    const partidaRef = doc(db, "partidas", partidaActual);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(partidaRef);
      if (!snap.exists()) throw new Error("Partida no existe (tx).");
      const data = snap.data();

      if (data.ganador && data.ganador !== "(Vacío)") throw new Error("Partida finalizada.");
      if (!data.jugadores) throw new Error("Partida inválida.");

      const email = user.email;
      const simboloLocal = (data.jugadores.jugador1.email === email) ? "X"
                         : (data.jugadores.jugador2.email === email) ? "O" : null;
      if (!simboloLocal) throw new Error("No eres jugador en esta partida.");
      if (data.turno !== simboloLocal) throw new Error("No es tu turno.");

      const ocupadas = Array(9).fill("");
      (data.movimientos || []).forEach(m => {
        const idx = (typeof m.index === "number") ? m.index
                  : (m.movimiento && /\d+/.test(m.movimiento)) ? parseInt(m.movimiento.match(/\d+/)[0]) : NaN;
        if (!isNaN(idx)) ocupadas[idx] = m.simbolo || "";
      });

      if (ocupadas[index]) throw new Error("Casilla ya ocupada.");

      const nuevoMovimiento = {
        jugador: email,
        movimiento: `Celda ${index}`,
        simbolo: simboloLocal,
        index: index,
        timestamp: new Date().toLocaleString()
      };

      const movimientosNuevos = [...(data.movimientos || []), nuevoMovimiento];
      const siguiente = simboloLocal === "X" ? "O" : "X";

      const nuevoBoard = Array(9).fill("");
      movimientosNuevos.forEach(m => {
        if (typeof m.index === "number") nuevoBoard[m.index] = m.simbolo;
      });

      const win = computeWinner(nuevoBoard);
      const updateObj = { movimientos: movimientosNuevos, turno: win ? null : siguiente };
      if (win) {
        updateObj.ganador = nuevoBoard[win[0]];
        updateObj.estado = "finalizada";
      }

      tx.update(partidaRef, updateObj);
    });

    await addDoc(collection(db, "movimientos"), {
      jugador: user.email,
      partidaId: partidaActual,
      movimiento: `Celda ${index}`,
      index,
      simbolo: turnoLocal,
      timestamp: serverTimestamp()
    });

  } catch (err) {
    alert("No se pudo hacer el movimiento: " + (err.message || err));
  }
}

// ----- Escuchar partida en tiempo real -----
function escucharPartida(partidaId) {
  const partidaRef = doc(db, "partidas", partidaId);
  boardDiv.style.display = "grid";
  gamePlaceholder.style.border = "none";

  onSnapshot(partidaRef, (snap) => {
    if (!snap.exists()) {
      alert("La partida fue borrada o no existe.");
      boardDiv.style.display = "none";
      return;
    }
    const p = snap.data();

    // 👉 Detectar si hay una nueva partida creada con "Volver a jugar"
    if (p.nextPartidaId && p.nextPartidaId !== partidaActual) {
      partidaActual = p.nextPartidaId;
      tablero = Array(9).fill("");
      lineGanadora = null;
      gamePlaceholder.style.border = "none";
      boardDiv.style.display = "grid";
      escucharPartida(partidaActual);
      return;
    }

    const curEmail = auth.currentUser ? auth.currentUser.email : null;
    if (curEmail) {
      if (p.jugadores?.jugador1?.email === curEmail) turnoLocal = "X";
      else if (p.jugadores?.jugador2?.email === curEmail) turnoLocal = "O";
      else turnoLocal = null;
    } else turnoLocal = null;

    tablero = Array(9).fill("");
    (p.movimientos || []).forEach(m => {
      let idx = typeof m.index === "number" ? m.index : NaN;
      if (!isNaN(idx)) tablero[idx] = m.simbolo || "";
    });

    const combo = computeWinner(tablero);
    lineGanadora = combo ? combo : null;
    ultimoJugadores = p.jugadores || ultimoJugadores;

    mostrarPartida(p);
    renderTableroUI();
  }, (err) => {
    console.error("Error snapshot partida:", err);
  });
}

// ----- Mostrar partida -----
function mostrarPartida(partida) {
  const movimientosHtml = partida.movimientos?.length
    ? partida.movimientos.map(m => `${m.jugador} → ${m.movimiento} (${m.simbolo}) [${m.timestamp}]`).join("\n")
    : "(No hay movimientos aún)";

  partidaDetallesDiv.innerText =
`ID: ${partida.id}
Estado: ${partida.estado}
Turno: ${partida.turno ?? "-"}
Jugadores:
  Jugador 1 (${partida.jugadores?.jugador1?.simbolo ?? "X"}): ${partida.jugadores?.jugador1?.email ?? "(Vacío)"}
  Jugador 2 (${partida.jugadores?.jugador2?.simbolo ?? "O"}): ${partida.jugadores?.jugador2?.email ?? "(Vacío)"}
Ganador: ${partida.ganador ?? "(Vacío)"}
Siguiente partida: ${partida.nextPartidaId ?? "(ninguna)"}
Movimientos:
${movimientosHtml}`.trim();
}

// ----- Volver a jugar -----
if (volverBtn) {
  volverBtn.addEventListener("click", async () => {
    if (!ultimoJugadores) return alert("Primero crea o únete a una partida");
    const nuevaId = Math.random().toString(36).substr(2, 8).toUpperCase();
    const turnoInicial = Math.random() < 0.5 ? "X" : "O";

    await setDoc(doc(db, "partidas", nuevaId), {
      id: nuevaId,
      estado: "En curso",
      turno: turnoInicial,
      jugadores: ultimoJugadores,
      ganador: "(Vacío)",
      movimientos: [],
      timestamp: serverTimestamp()
    });

    // 👉 Guardar la referencia en la partida anterior
    if (partidaActual) {
      await updateDoc(doc(db, "partidas", partidaActual), {
        nextPartidaId: nuevaId
      });
    }

    partidaActual = nuevaId;
    tablero = Array(9).fill("");
    lineGanadora = null;
    gamePlaceholder.style.border = "none";
    boardDiv.style.display = "grid";
    escucharPartida(nuevaId);
  });
}

// ----- Autenticación -----
document.getElementById("btnRegister").addEventListener("click", async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    alert("Usuario registrado: " + email);
  } catch (e) {
    alert("Error registro: " + e.message);
  }
});

document.getElementById("btnLogin").addEventListener("click", async () => {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    alert("Sesión iniciada: " + email);
  } catch (e) {
    alert("Error login: " + e.message);
  }
});

document.getElementById("btnLogout").addEventListener("click", async () => {
  try {
    await signOut(auth);
    alert("Sesión cerrada");
    partidaActual = null;
    boardDiv.style.display = "none";
    gamePlaceholder.style.border = "2px dashed #ccc";
  } catch (e) {
    alert("Error logout: " + e.message);
  }
});

onAuthStateChanged(auth, (user) => {
  console.log(user ? `Auth state: logged in ${user.email}` : "Auth state: logged out");
});

// ----- Crear partida -----
document.getElementById("btnCrearPartida").addEventListener("click", async () => {
  if (!auth.currentUser) return alert("Debes iniciar sesión para crear una partida");
  const partidaId = Math.random().toString(36).substr(2, 8).toUpperCase();
  const turnoInicial = Math.random() < 0.5 ? "X" : "O";
  const jugador1 = { email: auth.currentUser.email, simbolo: "X" };
  const jugador2 = { email: "(Vacío)", simbolo: "O" };

  await setDoc(doc(db, "partidas", partidaId), {
    id: partidaId,
    estado: "En curso",
    turno: turnoInicial,
    jugadores: { jugador1, jugador2 },
    ganador: "(Vacío)",
    movimientos: [],
    timestamp: serverTimestamp()
  });

  partidaActual = partidaId;
  boardDiv.style.display = "grid";
  gamePlaceholder.style.border = "none";
  escucharPartida(partidaId);

  resetContainer.style.display = "block";
  codigoInputContainer.after(resetContainer);
});

// ----- Unirse a partida -----
document.getElementById("btnUnirsePartida").addEventListener("click", async () => {
  const codigo = document.getElementById("codigoPartidaInput").value?.trim();
  if (!codigo) return alert("Ingresa un código de partida");
  if (!auth.currentUser) return alert("Debes iniciar sesión");

  const partidaRef = doc(db, "partidas", codigo);
  const snap = await getDoc(partidaRef);
  if (!snap.exists()) return alert("No existe la partida con ese código");
  const partida = snap.data();
  const email = auth.currentUser.email;

  if (partida.jugadores?.jugador1?.email === email || partida.jugadores?.jugador2?.email === email) {
    partidaActual = codigo;
    boardDiv.style.display = "grid";
    gamePlaceholder.style.border = "none";
    resetContainer.style.display = "block";
    codigoInputContainer.after(resetContainer);
    return escucharPartida(codigo);
  }

  try {
    await runTransaction(db, async (tx) => {
      const s = await tx.get(partidaRef);
      if (!s.exists()) throw new Error("La partida ya no existe");
      const data = s.data();
      if (data.jugadores?.jugador2?.email && data.jugadores.jugador2.email !== "(Vacío)") {
        throw new Error("La partida ya tiene dos jugadores");
      }
      const jugador2 = { email: email, simbolo: "O" };
      tx.update(partidaRef, { "jugadores.jugador2": jugador2, estado: "En curso" });
    });

    partidaActual = codigo;
    boardDiv.style.display = "grid";
    gamePlaceholder.style.border = "none";
    resetContainer.style.display = "block";
    codigoInputContainer.after(resetContainer);
    escucharPartida(codigo);
  } catch (e) {
    alert("No se pudo unir: " + e.message);
  }
});