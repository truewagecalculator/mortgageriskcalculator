// ===============================
// Mobile Dropdown Menu
// ===============================
    (function setupMobileDropdown(){
      const header = document.querySelector(".site-header");
      const btn = document.querySelector(".nav-toggle");
      const menu = document.getElementById("mobileMenu");

      if (!header || !btn || !menu) return;

      const open = () => {
        header.classList.add("nav-open");
        btn.setAttribute("aria-expanded", "true");
        menu.scrollTop = 0;
      };

      const close = () => {
        header.classList.remove("nav-open");
        btn.setAttribute("aria-expanded", "false");
      };

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        header.classList.contains("nav-open") ? close() : open();
      });

      // Close after clicking a link
      menu.querySelectorAll("a").forEach(a => a.addEventListener("click", close));

      // Close if you click outside
      document.addEventListener("click", (e) => {
        if (!header.contains(e.target)) close();
      });

      // Close on ESC
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close();
      });
  })();