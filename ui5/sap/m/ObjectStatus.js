/*!
 * SAP UI development toolkit for HTML5 (SAPUI5/OpenUI5)
 * (c) Copyright 2009-2014 SAP SE or an SAP affiliate company. 
 * Licensed under the Apache License, Version 2.0 - see LICENSE.txt.
 */
jQuery.sap.declare("sap.m.ObjectStatus");jQuery.sap.require("sap.m.library");jQuery.sap.require("sap.ui.core.Control");sap.ui.core.Control.extend("sap.m.ObjectStatus",{metadata:{library:"sap.m",properties:{"title":{type:"string",group:"Misc",defaultValue:null},"text":{type:"string",group:"Misc",defaultValue:null},"state":{type:"sap.ui.core.ValueState",group:"Misc",defaultValue:sap.ui.core.ValueState.None},"icon":{type:"sap.ui.core.URI",group:"Misc",defaultValue:null},"iconDensityAware":{type:"boolean",group:"Appearance",defaultValue:true},"visible":{type:"boolean",group:"Appearance",defaultValue:true}}}});jQuery.sap.require("sap.ui.core.IconPool");
sap.m.ObjectStatus.prototype.exit=function(){if(this._oImageControl){this._oImageControl.destroy();this._oImageControl=null}};
sap.m.ObjectStatus.prototype._getImageControl=function(){var i=this.getId()+'-icon';var p={src:this.getIcon(),densityAware:this.getIconDensityAware()};this._oImageControl=sap.m.ImageHelper.getImageControl(i,this._oImageControl,this,p);return this._oImageControl};
sap.m.ObjectStatus.prototype.setTitle=function(t){var T=this.$().children(".sapMObjStatusTitle"),s=!!T.length&&!!this.validateProperty("title",t).trim();this.setProperty("title",t,s);if(s){T.text(this.getTitle()+":")}return this};
sap.m.ObjectStatus.prototype.setText=function(t){var T=this.$().children(".sapMObjStatusText"),s=!!T.length&&!!this.validateProperty("text",t).trim();this.setProperty("text",t,s);if(s){T.text(this.getText())}return this};
sap.m.ObjectStatus.prototype._isEmpty=function(){return!(this.getText().trim()||this.getIcon().trim()||this.getTitle().trim())};
