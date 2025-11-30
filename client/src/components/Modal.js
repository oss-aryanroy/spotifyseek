import React from "react";
import "./modal.css";

export default function Modal({ open, onClose, children }) {
  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        {children}
        <button className="modal-button" onClick={onClose}>OK</button>
      </div>
    </div>
  );
}
