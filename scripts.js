const navToggle = document.getElementById("navToggle");
const navLinks = document.getElementById("navLinks");
const themeToggle = document.getElementById("themeToggle");
const THEME_KEY = "portfolio-theme";

function applyTheme(theme) {
    const isDark = theme === "dark";
    document.body.classList.toggle("dark", isDark);

    if (themeToggle) {
        themeToggle.textContent = isDark ? "Day mode" : "Night mode";
        themeToggle.setAttribute("aria-label", isDark ? "Switch to day mode" : "Switch to dark mode");
    }
}

function loadTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
    return "light";
}

applyTheme(loadTheme());

if (themeToggle) {
    themeToggle.addEventListener("click", () => {
        const isDark = document.body.classList.contains("dark");
        const nextTheme = isDark ? "light" : "dark";
        localStorage.setItem(THEME_KEY, nextTheme);
        applyTheme(nextTheme);
    });
}

if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
        const expanded = navToggle.getAttribute("aria-expanded") === "true";
        navToggle.setAttribute("aria-expanded", String(!expanded));
        navLinks.classList.toggle("show");
    });

    navLinks.querySelectorAll("a").forEach((link) => {
        link.addEventListener("click", () => {
            navLinks.classList.remove("show");
            navToggle.setAttribute("aria-expanded", "false");
        });
    });
}
