// site.js — shared site behavior (header mobile nav + year)
(() => {
  function initYear() {
    const y = document.getElementById("year");
    if (y) y.textContent = String(new Date().getFullYear());
  }

  function initMobileNav() {
    const header = document.querySelector(".site-header");
    const btn = document.querySelector(".nav-toggle");
    const menu = document.getElementById("mobileMenu");

    if (!header || !btn || !menu) return;

    function setOpen(isOpen) {
      btn.setAttribute("aria-expanded", String(isOpen));
      header.classList.toggle("nav-open", isOpen);
    }

    // Toggle button
    btn.addEventListener("click", () => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      setOpen(!isOpen);
    });

    // Close when clicking a link in the mobile menu
    menu.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => setOpen(false));
    });

    // Close when clicking outside
    document.addEventListener("click", (e) => {
      if (!header.contains(e.target)) setOpen(false);
    });

    // Close on Escape
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initYear();
    initMobileNav();
  });
})();
