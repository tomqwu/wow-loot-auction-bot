-- AuctionBridge: hover an item, press the keybinding, copy the generated
-- /auction start command, and paste it into Discord.
--
-- WoW addons cannot write to the OS clipboard, so we show the command in an
-- edit box with the text pre-selected and let the user press Ctrl+C.

BINDING_HEADER_AUCTIONBRIDGE = "AuctionBridge"
BINDING_NAME_AUCTIONBRIDGE_CAPTURE = "Capture hovered item for auction"

-- Default values inserted into the generated command (point-scale; tweak to
-- taste — e.g. raise them if your guild bids in gold).
local DEFAULT_START = 100
local DEFAULT_MIN_INCREMENT = 10
local DEFAULT_DURATION_MINUTES = 60

local copyFrame, copyEditBox, currentText

local function CreateCopyFrame()
    local frame = CreateFrame("Frame", "AuctionBridgeCopyFrame", UIParent, "BackdropTemplate")
    frame:SetSize(560, 110)
    frame:SetPoint("CENTER")
    frame:SetFrameStrata("DIALOG")
    frame:SetBackdrop({
        bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
        edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
        tile = true, tileSize = 32, edgeSize = 32,
        insets = { left = 8, right = 8, top = 8, bottom = 8 },
    })
    frame:SetMovable(true)
    frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    frame:Hide()

    local title = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    title:SetPoint("TOP", 0, -14)
    title:SetText("AuctionBridge — press Ctrl+C to copy, then paste into Discord")

    local editBox = CreateFrame("EditBox", "AuctionBridgeCopyEditBox", frame, "InputBoxTemplate")
    editBox:SetSize(520, 24)
    editBox:SetPoint("TOP", 0, -38)
    editBox:SetAutoFocus(true)
    editBox:SetScript("OnEscapePressed", function() frame:Hide() end)
    editBox:SetScript("OnEnterPressed", function() frame:Hide() end)
    editBox:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
    -- Keep the command intact if the user types over the selection.
    editBox:SetScript("OnTextChanged", function(self, userInput)
        if userInput and currentText then
            self:SetText(currentText)
            self:HighlightText()
        end
    end)

    local hint = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    hint:SetPoint("BOTTOM", 0, 16)
    hint:SetText("Esc or Enter closes this window.")

    local close = CreateFrame("Button", nil, frame, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", -4, -4)

    return frame, editBox
end

local function ShowCopyBox(text)
    if not copyFrame then
        copyFrame, copyEditBox = CreateCopyFrame()
    end
    currentText = text
    copyFrame:Show()
    copyEditBox:SetText(text)
    copyEditBox:SetFocus()
    copyEditBox:HighlightText()
end

local function GetHoveredItemLink()
    -- Item currently shown in the hover tooltip.
    if GameTooltip:IsShown() then
        local _, link = GameTooltip:GetItem()
        if link then return link end
    end
    -- Fall back to a clicked chat/item-ref tooltip if one is open.
    if ItemRefTooltip and ItemRefTooltip:IsShown() then
        local _, link = ItemRefTooltip:GetItem()
        if link then return link end
    end
    return nil
end

function AuctionBridge_CaptureItem()
    local link = GetHoveredItemLink()
    if not link then
        print("|cff33ff99AuctionBridge|r: hover an item tooltip first, then press the keybinding.")
        return
    end
    local itemId = link:match("Hitem:(%d+)")
    if itemId then
        print(("|cff33ff99AuctionBridge|r: captured item %s."):format(itemId))
    end
    local command = ('/auction start item_link:"%s" start:%d min_increment:%d duration_minutes:%d'):format(
        link, DEFAULT_START, DEFAULT_MIN_INCREMENT, DEFAULT_DURATION_MINUTES
    )
    ShowCopyBox(command)
end
