"use client";
import React, { useState } from "react";
import Select from "@/components/form/Select";

interface CountryCode {
  code: string;
  label: string;
}

interface PhoneInputProps {
  countries: CountryCode[];
  placeholder?: string;
  onChange?: (phoneNumber: string) => void;
  selectPosition?: "start" | "end"; // Dropdown position within the field
}

const PhoneInput: React.FC<PhoneInputProps> = ({
  countries,
  placeholder = "+1 (555) 000-0000",
  onChange,
  selectPosition = "start",
}) => {
  const [selectedCountry, setSelectedCountry] = useState<string>("US");
  const [phoneNumber, setPhoneNumber] = useState<string>("+1");

  const countryCodes: Record<string, string> = countries.reduce(
    (acc, { code, label }) => ({ ...acc, [code]: label }),
    {}
  );

  const handleCountryChange = (newCountry: string) => {
    setSelectedCountry(newCountry);
    setPhoneNumber(countryCodes[newCountry]);
    onChange?.(countryCodes[newCountry]);
  };

  const handlePhoneNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhoneNumber(e.target.value);
    onChange?.(e.target.value);
  };

  const countrySelect = (
    <div className="w-[88px] shrink-0">
      <Select
        variant="ghost"
        value={selectedCountry}
        onChange={handleCountryChange}
        ariaLabel="Country code"
        options={countries.map((c) => ({ value: c.code, label: c.code }))}
      />
    </div>
  );

  const divider = (
    <span className="h-6 w-px shrink-0 bg-gray-200 dark:bg-gray-800" />
  );

  return (
    <div className="flex h-11 w-full items-center rounded-lg border border-gray-300 bg-transparent shadow-theme-xs transition-colors duration-150 ease-out hover:border-gray-400 focus-within:border-brand-300 focus-within:ring-3 focus-within:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-gray-600">
      {selectPosition === "start" && (
        <>
          {countrySelect}
          {divider}
        </>
      )}
      <input
        type="tel"
        value={phoneNumber}
        onChange={handlePhoneNumberChange}
        placeholder={placeholder}
        className="h-full w-full min-w-0 bg-transparent px-4 text-sm text-gray-800 placeholder:text-gray-500 focus:outline-hidden dark:text-white/90 dark:placeholder:text-gray-400"
      />
      {selectPosition === "end" && (
        <>
          {divider}
          {countrySelect}
        </>
      )}
    </div>
  );
};

export default PhoneInput;
